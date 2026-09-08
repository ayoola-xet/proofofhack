import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import type { Pool } from "pg";
import { type Hex, toFunctionSignature } from "viem";
import { z } from "zod";
import type { ClaimRelayer } from "../../../services/worker/src/claim-process.ts";
import { bountyEscrowAbi } from "../../chain/src/abi/BountyEscrow.ts";
import { type ClaimCall, claimCallSchema } from "../../chain/src/claim-calls.ts";
import {
  type RecoveryCall,
  recoveryCallSchema,
  recoveryRequestKey,
} from "../../chain/src/recovery.ts";
import { address, bytes32, DomainError } from "../../domain/src/index.ts";

const execute = promisify(execFile);
export type CircleRunner = (args: string[]) => Promise<unknown>;
export const runCircle: CircleRunner = async (args) => {
  try {
    const { stdout } = await execute("pnpm", ["exec", "circle", ...args, "--output", "json"], {
      timeout: 150000,
      maxBuffer: 262144,
      encoding: "utf8",
    });
    return JSON.parse(stdout).data;
  } catch {
    // Provider output can contain session details. Do not attach it to the error.
    throw new DomainError(
      "CIRCLE_REQUEST_UNCERTAIN",
      "The saved Circle request needs a status check before it can complete.",
      503,
    );
  }
};
export function circleRequestId(key: string) {
  const h = createHash("sha256").update(`vulnproof:circle:v1:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function circleClaimArguments(input: ClaimCall) {
  const call = claimCallSchema.parse(input);
  const entry = bountyEscrowAbi.find((e) => e.type === "function" && e.name === call.method);
  if (entry?.type !== "function") throw new Error("Unknown claim function.");
  if (call.method === "collectPayment") return [toFunctionSignature(entry), call.payload.bountyId];
  const tuple = entry.inputs[0];
  if (!tuple || !("components" in tuple)) throw new Error("Missing claim tuple.");
  const values = tuple.components.map((field) => {
    const value = (call.payload as Record<string, string>)[field.name];
    if (value === undefined) throw new Error("Missing signed claim field.");
    return value;
  });
  return [toFunctionSignature(entry), JSON.stringify(values), call.signature];
}
export class CircleClaimRelayer implements ClaimRelayer {
  constructor(
    public walletId: string,
    private operator: Hex,
    private escrow: Hex,
    private run: CircleRunner = runCircle,
  ) {
    z.uuid().parse(walletId);
    address.parse(operator);
    address.parse(escrow);
  }
  async send(key: string, escrow: Hex, input: ClaimCall, requestId: string) {
    const call = claimCallSchema.parse(input);
    if (escrow !== this.escrow || !key.endsWith(`:${call.method}`))
      throw new DomainError(
        "RELAYER_SCOPE",
        "The transaction differs from the configured claim scope.",
      );
    const claimId = key.slice(0, -(call.method.length + 1));
    bytes32.parse(claimId);
    if ("claimId" in call.payload && call.payload.claimId !== claimId)
      throw new DomainError("RELAYER_SCOPE", "The transaction differs from the saved claim.");
    return this.execute(requestId, circleClaimArguments(call));
  }
  async sendRecovery(
    key: string,
    escrow: Hex,
    input: RecoveryCall,
    attempt: string,
    requestId: string,
  ) {
    const call = recoveryCallSchema.parse(input);
    if (escrow !== this.escrow || key !== recoveryRequestKey(call, attempt))
      throw new DomainError(
        "RELAYER_SCOPE",
        "The transaction differs from the saved recovery request.",
      );
    return this.execute(requestId, [`${call.method}(bytes32)`, call.bountyId]);
  }
  private async execute(requestId: string, args: string[]) {
    const idempotencyKey = z.uuid({ version: "v4" }).parse(requestId);
    const result = z
      .object({
        id: z.string().min(1),
        idempotencyKey: z.string(),
        txHash: bytes32,
        blockchain: z.literal("ARC-TESTNET"),
        sourceAddress: address,
        contractAddress: address.optional(),
        destinationAddress: address.optional(),
        state: z.enum(["CONFIRMED", "COMPLETE", "SENT", "PENDING", "QUEUED"]),
      })
      .parse(
        await this.run([
          "wallet",
          "execute",
          ...args,
          "--contract",
          this.escrow,
          "--address",
          this.operator,
          "--chain",
          "ARC-TESTNET",
          "--amount",
          "0",
          "--idempotency-key",
          idempotencyKey,
        ]),
      );
    if (
      result.idempotencyKey !== idempotencyKey ||
      result.sourceAddress !== this.operator ||
      (result.contractAddress ?? result.destinationAddress) !== this.escrow
    )
      throw new DomainError(
        "CIRCLE_RESPONSE_MISMATCH",
        "The Circle response does not match the saved transaction.",
        503,
      );
    return { hash: result.txHash, providerId: result.id };
  }
}
export async function configuredCircleRelayer(
  pool: Pool,
  operator: Hex,
  escrow: Hex,
  run: CircleRunner = runCircle,
) {
  const data = await run(["wallet", "list", "--chain", "ARC-TESTNET", "--type", "agent"]);
  const { wallets } = z
    .object({
      wallets: z.array(
        z.object({ type: z.literal("agent"), address, blockchain: z.literal("ARC-TESTNET") }),
      ),
    })
    .parse(data);
  if (!wallets.some((w) => w.address === operator))
    throw new Error("The configured Circle agent wallet is not available.");
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      `circle-relayer:${operator}`,
    ]);
    const providerId = `agent:ARC-TESTNET:${operator}`;
    let row = (
      await c.query("select * from wallets where provider='CIRCLE' and provider_wallet_id=$1", [
        providerId,
      ])
    ).rows[0];
    const ownerId = circleRequestId("claim-relay-service");
    if (!row)
      row = (
        await c.query(
          "insert into wallets(provider,provider_wallet_id,owner_type,owner_id,chain_id,address) values('CIRCLE',$1,'SERVICE',$2,'5042002',$3) returning *",
          [providerId, ownerId, operator],
        )
      ).rows[0];
    if (
      row.owner_type !== "SERVICE" ||
      row.owner_id !== ownerId ||
      row.address !== operator ||
      row.chain_id !== "5042002"
    )
      throw new Error("The stored Circle service wallet has different bindings.");
    await c.query("commit");
    return new CircleClaimRelayer(row.id, operator, escrow, run);
  } catch (error) {
    await c.query("rollback");
    throw error;
  } finally {
    c.release();
  }
}
