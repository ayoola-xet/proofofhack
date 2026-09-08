import type { Pool } from "pg";
import {
  keccak256,
  parseTransaction,
  recoverMessageAddress,
  recoverTransactionAddress,
  type TransactionSerialized,
} from "viem";
import { z } from "zod";
import type { BudgetChain } from "../../../packages/chain/src/budget.ts";
import type { FundingChain } from "../../../packages/chain/src/funding.ts";
import {
  ownerAuthorizationMessage,
  ownerCall,
  ownerCommandSchema,
} from "../../../packages/chain/src/owner-command.ts";
import { hashCanonical } from "../../../packages/crypto-envelope/src/index.ts";
import { address, DomainError } from "../../../packages/domain/src/index.ts";
import type { OwnerPermission } from "../../../packages/privy/src/owner-permission.ts";
import type {
  TreasuryConfiguration,
  TreasuryProvider,
  TreasuryWallet,
} from "../../../packages/privy/src/treasury.ts";
import type { WalletIdentityProvider } from "../../../packages/privy/src/wallets.ts";
import { first, member } from "../../api/src/context.ts";
import { ownerContext, validateOwnerCommand } from "./owner-context.ts";
import { ownerReceipt } from "./owner-receipt.ts";

export interface OwnerProvider extends Pick<TreasuryProvider, "sign" | "verify"> {
  setOwnerPermission(
    wallet: TreasuryWallet,
    config: TreasuryConfiguration,
    permission: OwnerPermission,
  ): Promise<void>;
  restoreOwnerPermission(
    wallet: TreasuryWallet,
    config: TreasuryConfiguration,
    permission: OwnerPermission,
  ): Promise<void>;
}
export async function processOwnerRequest(
  pool: Pool,
  provider: OwnerProvider,
  chain: FundingChain,
  controllerChain: BudgetChain,
  identities: WalletIdentityProvider,
  requestId: string,
) {
  z.uuid().parse(requestId);
  const c = await pool.connect();
  let lock: string | undefined;
  try {
    const base = await first(c, "select wallet_id from owner_requests where id=$1", [requestId]);
    lock = `treasury-wallet:${base.wallet_id}`;
    if (
      !(await c.query("select pg_try_advisory_lock(hashtextextended($1,0)) as locked", [lock]))
        .rows[0].locked
    ) {
      lock = undefined;
      throw new Error("Another action is in progress for the owner wallet.");
    }
    const row = await first(
      c,
      "select r.*,a.address as authorization_address,a.provider_wallet_id as authorization_provider_id,u.privy_user_id from owner_requests r join wallets a on a.id=r.authorization_wallet_id join users u on u.id=r.requested_by where r.id=$1",
      [requestId],
    );
    if (
      ["COMPLETE", "CANCELLED", "FAILED", "EXPIRED", "AWAITING_AUTHORIZATION"].includes(
        row.state,
      ) &&
      !row.permission_pending
    )
      return { state: row.state };
    const { binding, controller, wallet, setup, config } = await ownerContext(c, row.controller_id);
    const command = ownerCommandSchema.parse(row.command_json),
      call = ownerCall(binding.address, command);
    const permission: OwnerPermission = {
      controller: binding.address,
      command,
      expiresAt: row.authorization_expires_at.toISOString(),
    };
    const message = ownerAuthorizationMessage({
      requestId,
      actorId: row.requested_by,
      controller: binding.address,
      wallet: binding.owner,
      organizationId: binding.organizationId,
      command,
      expiresAt: permission.expiresAt,
    });
    if (
      row.wallet_id !== controller.owner_wallet_id ||
      row.organization_id !== controller.organization_id ||
      message !== row.authorization_message ||
      !row.authorization_signature ||
      address.parse(
        await recoverMessageAddress({ message, signature: row.authorization_signature }),
      ) !== row.authorization_address
    )
      throw new DomainError(
        "OWNER_AUTHORIZATION_MISMATCH",
        "The saved owner confirmation differs from this action.",
      );
    async function restore() {
      await provider.restoreOwnerPermission(wallet, config, permission);
      await c.query(
        "update owner_requests set permission_pending=false,updated_at=now() where id=$1",
        [requestId],
      );
    }
    if (row.permission_pending) await restore();
    async function authorizeNew() {
      await member(c, { id: row.requested_by, displayName: "" }, row.organization_id, ["OWNER"]);
      await first(c, "select id from organizations where id=$1 and status='ACTIVE'", [
        row.organization_id,
      ]);
      if (setup.state !== "READY")
        throw new DomainError("OWNER_NOT_READY", "The owner wallet needs verification.");
      if (row.authorization_expires_at <= new Date())
        throw new DomainError(
          "EXPIRED_AUTHORIZATION",
          "The owner confirmation has expired. Reconcile any saved transaction before a new request.",
        );
      const current = await identities.userWallets(row.privy_user_id);
      if (
        !current.some(
          (w) =>
            w.providerWalletId === row.authorization_provider_id &&
            address.parse(w.address) === row.authorization_address,
        )
      )
        throw new DomainError(
          "AUTHORIZER_NOT_LINKED",
          "The confirming Privy wallet is no longer linked to the owner.",
          403,
        );
      await validateOwnerCommand(c, row.organization_id, binding, config.maxPerAction, command);
      const state = await controllerChain.read(
        binding,
        command.kind === "APPROVE_POLICY" ? command.policyHash : `0x${"0".repeat(64)}`,
      );
      if (command.kind === "APPROVE_POLICY" && state.approval.consumed)
        throw new DomainError("POLICY_CONSUMED", "This controller approval is already used.");
      if (command.kind === "WITHDRAW" && state.balance < BigInt(command.amount))
        throw new DomainError(
          "BUDGET_BALANCE",
          "The controller has insufficient unallocated funds.",
        );
      if (
        command.kind === "SET_ENABLED" &&
        command.enabled &&
        (state.perActionLimit === 0n ||
          state.perActionLimit > BigInt(config.maxPerAction) ||
          state.dailyLimit > 100000000n ||
          state.minimumInterval < 60n)
      )
        throw new DomainError(
          "OWNER_LIMITS_REQUIRED",
          "Set controller limits within the organization wallet cap before enabling allocation.",
        );
      if (
        (await chain.balance(binding.owner)) <
        50000n + (command.kind === "DEPOSIT" ? BigInt(command.amount) : 0n)
      )
        throw new DomainError(
          "OWNER_BALANCE",
          "Add the action amount and at least 0.05 test USDC for network fees to the owner wallet.",
        );
      await provider.verify(wallet, config);
    }
    let intent = row.tx_intent_id
      ? await first(c, "select * from transaction_intents where id=$1", [row.tx_intent_id])
      : null;
    if (!intent) {
      await authorizeNew();
      if (
        (
          await c.query(
            "select id from transaction_intents where wallet_id=$1 and state not in('CONFIRMED','FAILED') limit 1",
            [row.wallet_id],
          )
        ).rowCount
      )
        throw new DomainError(
          "OWNER_PENDING_TRANSACTION",
          "Reconcile the wallet's pending transaction first.",
          503,
        );
      const prepared = await chain.prepare(binding.owner, call.to, call.data);
      const payload = {
        ...prepared,
        nonce: String(prepared.nonce),
        from: binding.owner,
        chainId: "5042002",
        value: "0",
        requestId,
      };
      await c.query("begin");
      try {
        intent = await first(
          c,
          "insert into transaction_intents(chain_id,provider,wallet_id,purpose,request_hash,idempotency_key,sender_nonce,state,request_json) values('5042002','PRIVY',$1,'CONTROLLER_OWNER',$2,$3,$4,'AWAITING_SIGNATURE',$5) returning *",
          [
            row.wallet_id,
            hashCanonical(payload),
            `owner:${requestId}`,
            payload.nonce,
            JSON.stringify(payload),
          ],
        );
        await c.query(
          "update owner_requests set tx_intent_id=$2,state='SIGNING',updated_at=now() where id=$1",
          [requestId, intent.id],
        );
        await c.query("commit");
      } catch (error) {
        await c.query("rollback");
        throw error;
      }
    }
    const expected = intent.request_json;
    if (
      intent.wallet_id !== row.wallet_id ||
      intent.provider !== "PRIVY" ||
      intent.purpose !== "CONTROLLER_OWNER" ||
      intent.chain_id !== "5042002" ||
      intent.idempotency_key !== `owner:${requestId}` ||
      hashCanonical(expected) !== intent.request_hash ||
      expected.to !== call.to ||
      expected.data !== call.data ||
      expected.from !== binding.owner ||
      expected.requestId !== requestId ||
      expected.chainId !== "5042002" ||
      expected.value !== "0" ||
      expected.nonce !== intent.sender_nonce ||
      !/^[0-9]+$/.test(expected.nonce) ||
      !Number.isSafeInteger(Number(expected.nonce)) ||
      BigInt(expected.gasLimit) * BigInt(expected.gasPrice) > 50000000000000000n
    )
      throw new DomainError(
        "OWNER_INTENT_MISMATCH",
        "The saved transaction differs from the owner confirmation.",
      );
    let signed = (
      await c.query("select * from signed_transactions where intent_id=$1", [intent.id])
    ).rows[0];
    if (!signed) {
      await authorizeNew();
      await c.query(
        "update owner_requests set permission_pending=true,updated_at=now() where id=$1",
        [requestId],
      );
      try {
        await provider.setOwnerPermission(wallet, config, permission);
        const result = await provider.sign(wallet, intent.idempotency_key, {
          to: call.to,
          data: call.data,
          nonce: Number(expected.nonce),
          gasLimit: expected.gasLimit,
          gasPrice: expected.gasPrice,
        });
        if (keccak256(result.serialized) !== result.hash)
          throw new Error("The owner transaction hash differs from its signed bytes.");
        await c.query("begin");
        try {
          signed = await first(
            c,
            "insert into signed_transactions(intent_id,serialized,transaction_hash) values($1,$2,$3) returning *",
            [intent.id, result.serialized, result.hash],
          );
          await c.query(
            "update transaction_intents set transaction_hash=$2,state='SIGNED',updated_at=now() where id=$1",
            [intent.id, result.hash],
          );
          await c.query("update owner_requests set state='SIGNED',updated_at=now() where id=$1", [
            requestId,
          ]);
          await c.query("commit");
        } catch (error) {
          await c.query("rollback");
          throw error;
        }
      } finally {
        await restore();
      }
    }
    const tx = parseTransaction(signed.serialized as TransactionSerialized);
    if (
      keccak256(signed.serialized) !== signed.transaction_hash ||
      (intent.transaction_hash && intent.transaction_hash !== signed.transaction_hash) ||
      address.parse(
        await recoverTransactionAddress({ serializedTransaction: signed.serialized }),
      ) !== binding.owner ||
      tx.chainId !== 5042002 ||
      tx.type !== "legacy" ||
      tx.to?.toLowerCase() !== call.to ||
      tx.data?.toLowerCase() !== call.data.toLowerCase() ||
      (tx.value ?? 0n) !== 0n ||
      tx.nonce !== Number(expected.nonce) ||
      tx.gas !== BigInt(expected.gasLimit) ||
      tx.gasPrice !== BigInt(expected.gasPrice)
    )
      throw new DomainError(
        "OWNER_SIGNATURE_MISMATCH",
        "The signed owner transaction has different terms.",
      );
    let receipt = await chain.finalReceipt(signed.transaction_hash);
    if (!receipt) {
      if (!["SUBMITTED", "BROADCAST"].includes(intent.state)) await authorizeNew();
      await c.query(
        "update transaction_intents set state='SUBMITTED',updated_at=now() where id=$1",
        [intent.id],
      );
      await c.query("update owner_requests set state='CONFIRMING',updated_at=now() where id=$1", [
        requestId,
      ]);
      if ((await chain.broadcast(signed.serialized)) !== signed.transaction_hash)
        throw new Error("The owner transaction broadcast hash differs.");
      await c.query(
        "update transaction_intents set state='BROADCAST',updated_at=now() where id=$1",
        [intent.id],
      );
      receipt = await chain.finalReceipt(signed.transaction_hash);
    }
    if (!receipt)
      throw new DomainError(
        "AWAITING_FINALITY",
        "The saved owner transaction awaits a final receipt.",
        503,
      );
    if (receipt.hash !== signed.transaction_hash)
      throw new Error("The owner receipt hash differs from the saved transaction.");
    if (receipt.status !== "success") {
      await c.query("update transaction_intents set state='FAILED',updated_at=now() where id=$1", [
        intent.id,
      ]);
      await c.query(
        "update owner_requests set state='FAILED',failure_code='TRANSACTION_REVERTED',updated_at=now() where id=$1",
        [requestId],
      );
      return { state: "FAILED" };
    }
    const proof = ownerReceipt(receipt, binding, command);
    await c.query("begin");
    try {
      const event = await first(
        c,
        "insert into chain_events(chain_id,contract_address,transaction_hash,log_index,block_number,block_hash,name,payload_json,finality_state) values('5042002',$1,$2,$3,$4,$5,$6,$7,'FINAL') on conflict(chain_id,transaction_hash,log_index) do update set updated_at=now() returning id",
        [
          proof.contract,
          receipt.hash,
          proof.logIndex,
          String(receipt.blockNumber),
          receipt.blockHash,
          proof.name,
          JSON.stringify(proof.payload),
        ],
      );
      if (command.kind === "APPROVE_POLICY")
        await c.query(
          "insert into approved_allocations(controller_id,policy_hash,reward,expires_at) values($1,$2,$3,$4) on conflict(controller_id,policy_hash) do update set reward=excluded.reward,expires_at=excluded.expires_at,updated_at=now() where approved_allocations.consumed_event_ref is null",
          [
            row.controller_id,
            command.policyHash,
            command.reward,
            new Date(Number(command.expiresAt) * 1000),
          ],
        );
      if (command.kind === "DEPOSIT" || command.kind === "WITHDRAW")
        await c.query(
          "insert into receipts(organization_id,category,amount,asset,event_id,status) values($1,$2,$3,$4,$5,'FINAL') on conflict(event_id,category) do nothing",
          [row.organization_id, `BUDGET_${command.kind}`, command.amount, binding.asset, event.id],
        );
      await c.query(
        "update transaction_intents set state='CONFIRMED',updated_at=now() where id=$1",
        [intent.id],
      );
      await c.query(
        "update owner_requests set state='COMPLETE',failure_code=null,receipt_json=$2,version=version+1,updated_at=now() where id=$1",
        [
          requestId,
          JSON.stringify({
            transactionHash: receipt.hash,
            blockNumber: String(receipt.blockNumber),
            blockHash: receipt.blockHash,
            eventId: event.id,
            ...proof,
          }),
        ],
      );
      await c.query(
        "insert into outbox(deduplication_key,event_type,aggregate_id,payload_json) values($1,'COVERAGE_REFRESH',$2,$3) on conflict(deduplication_key) do nothing",
        [
          `owner-coverage:${requestId}`,
          row.organization_id,
          JSON.stringify({ organizationId: row.organization_id }),
        ],
      );
      await c.query("commit");
    } catch (error) {
      await c.query("rollback");
      throw error;
    }
    return { state: "COMPLETE", hash: receipt.hash };
  } catch (error) {
    if (error instanceof DomainError && error.code === "EXPIRED_AUTHORIZATION") {
      const expired = await c.query(
        "update owner_requests set state='EXPIRED',failure_code='EXPIRED_AUTHORIZATION',updated_at=now() where id=$1 and tx_intent_id is null and permission_pending=false and state<>'COMPLETE'",
        [requestId],
      );
      if (expired.rowCount) return { state: "EXPIRED" };
    }
    await c.query(
      "update owner_requests set failure_code=$2,updated_at=now() where id=$1 and state<>'COMPLETE'",
      [requestId, error instanceof DomainError ? error.code : "RETRY_REQUIRED"],
    );
    throw error;
  } finally {
    if (lock) await c.query("select pg_advisory_unlock(hashtextextended($1,0))", [lock]);
    c.release();
  }
}
