import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { type Address, encodeFunctionData, erc20Abi } from "viem";
import { ARC_USDC, arcClient } from "../../../packages/chain/src/arc.ts";
import { assertTransferMatches, hasExactTransfer } from "../../../packages/chain/src/transfers.ts";
import { DomainError } from "../../../packages/domain/src/index.ts";
import type { WalletIdentityProvider } from "../../../packages/privy/src/wallets.ts";
import { first, idParams, mutate } from "./context.ts";
import { parseApiBody } from "./parse-body.ts";

export function registerWalletRoutes(
  app: FastifyInstance,
  pool: Pool,
  identities?: WalletIdentityProvider,
) {
  const chain = arcClient();
  async function liveWallets(actorId: string) {
    if (!identities)
      throw new DomainError(
        "PROVIDER_NOT_CONFIGURED",
        "Wallet verification is not configured.",
        503,
      );
    const user = await first(pool, "select privy_user_id from users where id=$1", [actorId]);
    return identities.userWallets(user.privy_user_id);
  }
  async function ownedWallet(actorId: string, id: string) {
    return first(
      pool,
      "select * from wallets where id=$1 and owner_type='USER' and owner_id=$2 and provider='PRIVY' and chain_id='5042002'",
      [id, actorId],
    );
  }
  app.post("/api/v1/wallets/sync", async (request, reply) => {
    parseApiBody("empty", request);
    const verified = await liveWallets(request.actor.id);
    const result = await mutate(
      pool,
      request,
      async () => {},
      async (c) => {
        const items = [];
        for (const wallet of verified) {
          const saved = await first(
            c,
            `insert into wallets(provider,provider_wallet_id,owner_type,owner_id,chain_id,address)
          values('PRIVY',$1,'USER',$2,'5042002',$3) on conflict(provider,provider_wallet_id,chain_id)
          do update set address=excluded.address where wallets.owner_type='USER' and wallets.owner_id=excluded.owner_id
          returning id,provider,address,chain_id`,
            [wallet.providerWalletId, request.actor.id, wallet.address],
          );
          items.push(saved);
        }
        return { status: 200, body: { items } };
      },
    );
    return reply.code(result.status).send(result.body);
  });
  app.get("/api/v1/wallets/:id/balance", async (request) => {
    const { id } = idParams(request);
    const wallet = await ownedWallet(request.actor.id, id);
    const block = await chain.getBlock({ blockTag: "latest" });
    const [native, token] = await Promise.all([
      chain.getBalance({ address: wallet.address, blockNumber: block.number }),
      chain.readContract({
        address: ARC_USDC,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet.address],
        blockNumber: block.number,
      }),
    ]);
    return {
      walletId: id,
      chainId: "5042002",
      asset: ARC_USDC,
      amount: token.toString(),
      decimals: 6,
      nativeAmount: native.toString(),
      nativeDecimals: 18,
      blockNumber: block.number.toString(),
      blockHash: block.hash,
      sameUnderlyingBalance: true,
    };
  });
  app.post("/api/v1/wallets/:id/transfers", async (request, reply) => {
    const { id } = idParams(request);
    const input = parseApiBody("transfer", request);
    if (input.to === "0x0000000000000000000000000000000000000000")
      throw new DomainError("INVALID_RECIPIENT", "Enter a nonzero recipient address.", 400);
    const wallet = await ownedWallet(request.actor.id, id);
    const current = await liveWallets(request.actor.id);
    if (
      !current.some(
        (w) => w.providerWalletId === wallet.provider_wallet_id && w.address === wallet.address,
      )
    )
      throw new DomainError("WALLET_UNLINKED", "Verify a currently linked wallet.", 403);
    const result = await mutate(
      pool,
      request,
      async (c) => {
        await first(c, "select id from wallets where id=$1 and owner_id=$2 for update", [
          id,
          request.actor.id,
        ]);
      },
      async (c) => {
        const pending = await c.query(
          "select id from transaction_intents where wallet_id=$1 and state in('AWAITING_SIGNATURE','BROADCAST','SUBMITTED','UNKNOWN')",
          [id],
        );
        if (pending.rowCount)
          throw new DomainError(
            "PENDING_TRANSFER",
            "Resolve the current transfer before you start another.",
          );
        const nonce = await chain.getTransactionCount({
          address: wallet.address,
          blockTag: "pending",
        });
        const balance = await chain.readContract({
          address: ARC_USDC,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [wallet.address],
        });
        if (balance < BigInt(input.amount))
          throw new DomainError("INSUFFICIENT_BALANCE", "The wallet needs more test USDC.");
        const transaction = {
          from: wallet.address,
          to: ARC_USDC,
          chainId: 5042002,
          value: "0",
          nonce,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [input.to as Address, BigInt(input.amount)],
          }),
          recipient: input.to,
          amount: input.amount,
        };
        const row = await first(
          c,
          `insert into transaction_intents(chain_id,provider,wallet_id,purpose,request_hash,idempotency_key,sender_nonce,state,request_json)
        values('5042002','PRIVY',$1,'USER_TRANSFER',$2,$3,$4,'AWAITING_SIGNATURE',$5) returning id,state,request_json as transaction`,
          [
            id,
            createHash("sha256").update(JSON.stringify(transaction)).digest("hex"),
            request.headers["idempotency-key"],
            String(nonce),
            JSON.stringify(transaction),
          ],
        );
        return { status: 201, body: row };
      },
    );
    return reply.code(result.status).send(result.body);
  });
  app.get("/api/v1/wallets/:id/transfers", async (request) => {
    const { id } = idParams(request);
    await ownedWallet(request.actor.id, id);
    return {
      items: (
        await pool.query(
          "select id,state,transaction_hash,request_json as transaction,created_at from transaction_intents where wallet_id=$1 and purpose='USER_TRANSFER' order by created_at desc limit 50",
          [id],
        )
      ).rows,
    };
  });
  app.post("/api/v1/transfers/:id/broadcast", async (request, reply) => {
    const { id } = idParams(request);
    const input = parseApiBody("transactionHash", request);
    const intent = await first(
      pool,
      "select t.*,w.address from transaction_intents t join wallets w on w.id=t.wallet_id where t.id=$1 and t.purpose='USER_TRANSFER' and w.owner_type='USER' and w.owner_id=$2",
      [id, request.actor.id],
    );
    const tx = await chain.getTransaction({ hash: input.transactionHash });
    const expected = intent.request_json;
    assertTransferMatches(tx, expected);
    const receipt = await chain
      .getTransactionReceipt({ hash: input.transactionHash })
      .catch(() => null);
    if (receipt?.status === "success" && !hasExactTransfer(receipt.logs, expected))
      throw new DomainError(
        "TRANSFER_EVENT_MISSING",
        "The transaction has no matching USDC transfer.",
        409,
      );
    const canonical = receipt ? await chain.getBlock({ blockNumber: receipt.blockNumber }) : null;
    const finalized = receipt ? await chain.getBlock({ blockTag: "finalized" }) : null;
    const state =
      receipt &&
      canonical?.hash === receipt.blockHash &&
      finalized &&
      finalized.number >= receipt.blockNumber
        ? receipt.status === "success"
          ? "CONFIRMED"
          : "FAILED"
        : "BROADCAST";
    const result = await mutate(
      pool,
      request,
      async (c) => {
        await first(
          c,
          "select t.id from transaction_intents t join wallets w on w.id=t.wallet_id where t.id=$1 and w.owner_id=$2 for update of t",
          [id, request.actor.id],
        );
      },
      async (c) => {
        const locked = await first(
          c,
          "select transaction_hash from transaction_intents where id=$1",
          [id],
        );
        if (locked.transaction_hash && locked.transaction_hash !== input.transactionHash)
          throw new DomainError("TRANSACTION_CONFLICT", "This transfer already has a transaction.");
        const row = await first(
          c,
          "update transaction_intents set transaction_hash=$2,state=$3,version=version+1,updated_at=now() where id=$1 returning id,state,transaction_hash",
          [id, input.transactionHash, state],
        );
        return { status: 200, body: row };
      },
    );
    return reply.code(result.status).send(result.body);
  });
}
