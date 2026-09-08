import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import {
  type Hex,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  type TransactionSerialized,
} from "viem";
import { z } from "zod";
import { ARC_USDC } from "../../../packages/chain/src/arc.ts";
import { parseApiBody } from "./parse-body.ts";

const readMethods = new Set([
  "eth_chainId",
  "net_version",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getTransactionCount",
  "eth_getCode",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
]);
const viewSelectors = new Set([
  "0x06fdde03",
  "0x95d89b41",
  "0x313ce567",
  "0x70a08231",
  "0xdd62ed3e",
  "0x18160ddd",
]);
export function registerRpcRoutes(app: FastifyInstance, pool: Pool) {
  app.post(
    "/api/v1/rpc/arc",
    { bodyLimit: 50000, config: { rateLimit: { max: 180, timeWindow: "1 minute" } } },
    async (request) => {
      const payload = parseApiBody("arcRpc", request);
      const batch = Array.isArray(payload);
      const inputs = Array.isArray(payload) ? payload : [payload];
      const outputs = [];
      for (const input of inputs) {
        try {
          let intentId: string | undefined;
          let transactionHash: Hex | undefined;
          if (input.method === "eth_sendRawTransaction") {
            const raw = z
              .string()
              .regex(/^0x[0-9a-fA-F]+$/)
              .max(20000)
              .parse(input.params[0]) as Hex;
            const tx = parseTransaction(raw);
            const from = (
              await recoverTransactionAddress({
                serializedTransaction: raw as TransactionSerialized,
              })
            ).toLowerCase();
            if (
              tx.chainId !== 5042002 ||
              tx.to?.toLowerCase() !== ARC_USDC ||
              (tx.value ?? 0n) !== 0n
            )
              throw new Error("Transaction outside the approved scope.");
            const row = (
              await pool.query(
                `select t.id from transaction_intents t join wallets w on w.id=t.wallet_id
            where t.provider='PRIVY' and t.purpose='USER_TRANSFER' and t.chain_id='5042002'
            and t.state in('AWAITING_SIGNATURE','SUBMITTED','UNKNOWN','BROADCAST') and w.address=$1 and t.sender_nonce=$2
            and t.request_json->>'data'=$3 and t.request_json->>'to'=$4
            and (t.transaction_hash is null or t.transaction_hash=$5) limit 1`,
                [from, String(tx.nonce), tx.data, ARC_USDC, keccak256(raw)],
              )
            ).rows[0];
            if (!row) throw new Error("No matching saved transfer.");
            intentId = row.id;
            transactionHash = keccak256(raw);
          } else if (input.method === "eth_call" || input.method === "eth_estimateGas") {
            const tx = z
              .object({
                to: z.string(),
                data: z.string().optional(),
                input: z.string().optional(),
                from: z.string().optional(),
                value: z.string().optional(),
              })
              .passthrough()
              .parse(input.params[0]);
            if (tx.to.toLowerCase() !== ARC_USDC || (tx.value && BigInt(tx.value) !== 0n))
              throw new Error("Unsupported contract call.");
            const data = (tx.data ?? tx.input ?? "0x").toLowerCase();
            if (input.method === "eth_call") {
              if (!viewSelectors.has(data.slice(0, 10))) throw new Error("Unsupported read call.");
            } else {
              const pending = await pool.query(
                "select id from transaction_intents where purpose='USER_TRANSFER' and state in('AWAITING_SIGNATURE','SUBMITTED','UNKNOWN','BROADCAST') and request_json->>'from'=$1 and request_json->>'data'=$2 limit 1",
                [tx.from?.toLowerCase(), data],
              );
              if (!pending.rowCount) throw new Error("No matching saved transfer.");
            }
          } else if (!readMethods.has(input.method)) throw new Error("Unsupported RPC method.");
          if (
            input.method === "eth_feeHistory" &&
            (typeof input.params[0] !== "string" || BigInt(input.params[0]) > 100n)
          )
            throw new Error("Fee history exceeds its limit.");
          if (
            ["eth_getBlockByNumber", "eth_getBlockByHash"].includes(input.method) &&
            input.params[1] !== false
          )
            throw new Error("Full block transactions are unavailable.");
          if (intentId && transactionHash) {
            const saved = await pool.query(
              "update transaction_intents set transaction_hash=$2,state=case when state='BROADCAST' then state else 'SUBMITTED' end,updated_at=now(),version=version+1 where id=$1 and (transaction_hash is null or transaction_hash=$2) returning id",
              [intentId, transactionHash],
            );
            if (!saved.rowCount)
              throw new Error("The signed transfer conflicts with the saved transaction.");
          }
          const response = await fetch("https://rpc.testnet.arc.io", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
            signal: AbortSignal.timeout(15000),
            redirect: "error",
          });
          if (!response.ok) throw new Error("Arc RPC is unavailable.");
          const result = await response.json();
          if (intentId && transactionHash && result.result === transactionHash)
            await pool.query(
              "update transaction_intents set transaction_hash=$2,state='BROADCAST',updated_at=now(),version=version+1 where id=$1 and state in('SUBMITTED','UNKNOWN') and transaction_hash=$2",
              [intentId, transactionHash],
            );
          outputs.push(result);
        } catch {
          outputs.push({
            jsonrpc: "2.0",
            id: input.id,
            error: {
              code: -32000,
              message: "The Arc request is unavailable or outside the approved wallet scope.",
            },
          });
        }
      }
      return batch ? outputs : outputs[0];
    },
  );
}
