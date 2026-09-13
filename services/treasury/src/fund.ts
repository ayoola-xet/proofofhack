import type { Pool, PoolClient } from "pg";
import { encodeFunctionData, type Hex, keccak256, recoverMessageAddress } from "viem";
import { z } from "zod";
import { bountyEscrowAbi } from "../../../packages/chain/src/abi/BountyEscrow.ts";
import { ARC_USDC } from "../../../packages/chain/src/arc.ts";
import {
  exactApproval,
  exactBountyFunding,
  type FundingChain,
  type FundingReceipt,
} from "../../../packages/chain/src/funding.ts";
import { contractPolicy } from "../../../packages/chain/src/policy.ts";
import { hashCanonical } from "../../../packages/crypto-envelope/src/index.ts";
import {
  address,
  bytes32,
  DomainError,
  hashPolicy,
  policySchema,
} from "../../../packages/domain/src/index.ts";
import { fundingAuthorizationMessage } from "../../../packages/privy/src/funding-authorization.ts";
import {
  approvalAbi,
  type TreasuryProvider,
  type TreasuryWallet,
} from "../../../packages/privy/src/treasury.ts";
import { first, member } from "../../api/src/context.ts";

export async function fundBounty(
  pool: Pool,
  provider: TreasuryProvider,
  chain: FundingChain,
  fundingId: string,
) {
  z.uuid().parse(fundingId);
  const c = await pool.connect();
  let lock: string | undefined;
  try {
    const base = await first(c, "select wallet_id from funding_requests where id=$1", [fundingId]);
    lock = `treasury-wallet:${base.wallet_id}`;
    const locked = (
      await c.query("select pg_try_advisory_lock(hashtextextended($1,0)) as locked", [lock])
    ).rows[0].locked;
    if (!locked) {
      lock = undefined;
      throw new Error("Another funding action is running for this wallet.");
    }
    const row = await first(
      c,
      `select f.*,d.policy_json,d.policy_hash,d.program_id,d.severity_tier_id,d.status as draft_status,
      w.address,w.provider_wallet_id,s.owner_id as provider_owner_id,s.provider_policy_id,s.configuration_json,s.state as setup_state,
      a.address as authorization_address from funding_requests f join bounty_drafts d on d.id=f.draft_id
      join wallets w on w.id=f.wallet_id join wallet_setups s on s.wallet_id=w.id join wallets a on a.id=f.authorization_wallet_id where f.id=$1`,
      [fundingId],
    );
    if (row.state === "FUNDED") return { state: "FUNDED" };
    if (["AWAITING_AUTHORIZATION", "CANCELLED", "EXPIRED", "FAILED"].includes(row.state))
      return { state: row.state };
    const policy = policySchema.parse(row.policy_json);
    const config = z
      .strictObject({ organizationId: bytes32, escrow: address, maxPerAction: z.string() })
      .parse(row.configuration_json);
    const message = fundingAuthorizationMessage({
      requestId: fundingId,
      actorId: row.requested_by,
      walletAddress: row.address,
      policyHash: row.policy_hash,
      policy,
      expiresAt: row.authorization_expires_at.toISOString(),
    });
    if (
      message !== row.authorization_message ||
      !row.authorization_signature ||
      address.parse(
        await recoverMessageAddress({ message, signature: row.authorization_signature }),
      ) !== row.authorization_address ||
      hashPolicy(policy) !== row.policy_hash ||
      row.draft_status !== "APPROVED" ||
      policy.settlementChainId !== "5042002" ||
      policy.escrow !== config.escrow ||
      policy.organizationId !== config.organizationId ||
      policy.asset !== ARC_USDC ||
      policy.refundRecipient !== row.address ||
      BigInt(policy.reward) > BigInt(config.maxPerAction)
    )
      throw new DomainError(
        "FUNDING_AUTHORIZATION_MISMATCH",
        "The saved funding authorization does not match the approved policy.",
      );
    const wallet: TreasuryWallet = {
      id: row.provider_wallet_id,
      address: address.parse(row.address),
      ownerId: row.provider_owner_id,
      policyIds: [row.provider_policy_id],
    };
    async function authorizeNewSignature() {
      await member(c, { id: row.requested_by, displayName: "" }, row.organization_id, [
        "OWNER",
        "TREASURY",
      ]);
      await first(c, "select id from organizations where id=$1 and status='ACTIVE'", [
        row.organization_id,
      ]);
      if (row.setup_state !== "READY")
        throw new DomainError("WALLET_NOT_READY", "Verify the organization wallet before funding.");
      if (
        row.authorization_expires_at.getTime() <= Date.now() ||
        BigInt(policy.submissionDeadline) <= BigInt(Math.floor(Date.now() / 1000) + 30)
      )
        throw new DomainError(
          "EXPIRED_AUTHORIZATION",
          "The funding authorization or bounty deadline has expired.",
        );
      await provider.verify(wallet, config);
    }
    async function step(
      kind: "APPROVE" | "FUND",
      to: Hex,
      data: Hex,
    ): Promise<FundingReceipt | null> {
      const column = kind === "APPROVE" ? "approval_intent_id" : "funding_intent_id";
      let intent = row[column]
        ? await first(c, "select * from transaction_intents where id=$1", [row[column]])
        : null;
      if (!intent) {
        await authorizeNewSignature();
        const pending = (
          await c.query(
            "select id from transaction_intents where wallet_id=$1 and state not in('CONFIRMED','FAILED') limit 1",
            [row.wallet_id],
          )
        ).rows[0];
        if (pending)
          throw new Error("Resolve the wallet's pending transaction before another action.");
        const feeReserve = kind === "APPROVE" ? 100000n : 50000n;
        if ((await chain.balance(wallet.address)) < BigInt(policy.reward) + feeReserve)
          throw new DomainError(
            "INSUFFICIENT_BALANCE",
            "Add the reward and at least 0.1 test USDC for network fees to the funding wallet.",
          );
        const prepared = await chain.prepare(wallet.address, to, data);
        const payload = {
          ...prepared,
          nonce: String(prepared.nonce),
          from: wallet.address,
          chainId: "5042002",
          value: "0",
          fundingId,
          kind,
        };
        await c.query("begin");
        try {
          intent = await first(
            c,
            "insert into transaction_intents(chain_id,provider,wallet_id,purpose,request_hash,idempotency_key,sender_nonce,state,request_json) values('5042002','PRIVY',$1,$2,$3,$4,$5,'AWAITING_SIGNATURE',$6) returning *",
            [
              row.wallet_id,
              `BOUNTY_${kind}`,
              hashCanonical(payload),
              `${fundingId}:${kind}`,
              payload.nonce,
              JSON.stringify(payload),
            ],
          );
          await c.query(
            `update funding_requests set ${column}=$2,state=$3,updated_at=now() where id=$1`,
            [fundingId, intent.id, kind === "APPROVE" ? "APPROVING" : "FUNDING"],
          );
          await c.query("commit");
          row[column] = intent.id;
        } catch (error) {
          await c.query("rollback");
          throw error;
        }
      }
      const expected = intent.request_json;
      if (
        intent.wallet_id !== row.wallet_id ||
        intent.purpose !== `BOUNTY_${kind}` ||
        expected.to !== to ||
        expected.data !== data ||
        expected.from !== wallet.address ||
        expected.fundingId !== fundingId ||
        expected.kind !== kind ||
        expected.chainId !== "5042002" ||
        expected.value !== "0" ||
        hashCanonical(expected) !== intent.request_hash ||
        expected.nonce !== intent.sender_nonce ||
        !/^[0-9]+$/.test(expected.nonce) ||
        !Number.isSafeInteger(Number(expected.nonce)) ||
        BigInt(expected.gasLimit) * BigInt(expected.gasPrice) > 50000000000000000n
      )
        throw new DomainError(
          "INTENT_MISMATCH",
          "The saved transaction does not match the approved action.",
        );
      let signed = (
        await c.query("select * from signed_transactions where intent_id=$1", [intent.id])
      ).rows[0];
      if (!signed) {
        await authorizeNewSignature();
        const result = await provider.sign(wallet, intent.idempotency_key, {
          to,
          data,
          nonce: Number(expected.nonce),
          gasLimit: expected.gasLimit,
          gasPrice: expected.gasPrice,
        });
        if (keccak256(result.serialized) !== result.hash)
          throw new Error("The signed transaction hash does not match.");
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
          await c.query("commit");
        } catch (error) {
          await c.query("rollback");
          throw error;
        }
      }
      if (
        keccak256(signed.serialized) !== signed.transaction_hash ||
        (intent.transaction_hash && intent.transaction_hash !== signed.transaction_hash)
      )
        throw new Error("Stored signature integrity check failed.");
      let receipt = await chain.finalReceipt(signed.transaction_hash);
      if (!receipt) {
        if (!["SUBMITTED", "BROADCAST", "CONFIRMED"].includes(intent.state))
          await authorizeNewSignature();
        // Save the exact hash before broadcast. An unknown result retries only these bytes.
        await c.query(
          "update transaction_intents set state='SUBMITTED',updated_at=now() where id=$1",
          [intent.id],
        );
        const hash = await chain.broadcast(signed.serialized);
        if (hash !== signed.transaction_hash) throw new Error("The broadcast hash does not match.");
        await c.query(
          "update transaction_intents set state='BROADCAST',updated_at=now() where id=$1",
          [intent.id],
        );
        receipt = await chain.finalReceipt(hash);
      }
      if (!receipt) return null;
      if (receipt.hash !== signed.transaction_hash)
        throw new Error("The final receipt hash does not match.");
      if (receipt.status !== "success") {
        await c.query(
          "update transaction_intents set state='FAILED',updated_at=now() where id=$1",
          [intent.id],
        );
        await c.query(
          "update funding_requests set state='FAILED',failure_code='TRANSACTION_REVERTED',updated_at=now() where id=$1",
          [fundingId],
        );
        throw new DomainError(
          "TRANSACTION_REVERTED",
          "The final transaction reverted. Review the funding request.",
        );
      }
      if (
        kind === "APPROVE" &&
        !exactApproval(receipt, wallet.address, policy.escrow, policy.reward)
      )
        throw new DomainError(
          "APPROVAL_EVENT_MISMATCH",
          "The final transaction has no exact token approval.",
        );
      if (kind === "FUND") exactBountyFunding(receipt, wallet.address, policy);
      await c.query(
        "update transaction_intents set state='CONFIRMED',updated_at=now() where id=$1",
        [intent.id],
      );
      return receipt;
    }
    const approval = await step(
      "APPROVE",
      ARC_USDC,
      encodeFunctionData({
        abi: approvalAbi,
        functionName: "approve",
        args: [policy.escrow, BigInt(policy.reward)],
      }),
    );
    if (!approval) return { state: "CONFIRMING_APPROVAL" };
    const receipt = await step(
      "FUND",
      policy.escrow,
      encodeFunctionData({
        abi: bountyEscrowAbi,
        functionName: "createAndFund",
        args: [contractPolicy(policy)],
      }),
    );
    if (!receipt) return { state: "CONFIRMING_FUNDING" };
    const event = exactBountyFunding(receipt, wallet.address, policy);
    await recordFunding(
      c,
      {
        id: row.id,
        policy_hash: row.policy_hash,
        program_id: row.program_id,
        organization_id: row.organization_id,
        severity_tier_id: row.severity_tier_id,
      },
      policy,
      receipt,
      event.logIndex,
    );
    return { state: "FUNDED", hash: receipt.hash };
  } catch (error) {
    await c.query(
      "update funding_requests set failure_code=$2,updated_at=now() where id=$1 and state<>'FUNDED'",
      [fundingId, error instanceof DomainError ? error.code : "RETRY_REQUIRED"],
    );
    throw error;
  } finally {
    if (lock) await c.query("select pg_advisory_unlock(hashtextextended($1,0))", [lock]);
    c.release();
  }
}
async function recordFunding(
  c: PoolClient,
  row: {
    id: string;
    policy_hash: string;
    program_id: string;
    organization_id: string;
    severity_tier_id: string | null;
  },
  policy: ReturnType<typeof policySchema.parse>,
  receipt: FundingReceipt,
  logIndex: number | null,
) {
  if (logIndex === null) throw new Error("The funding event needs a log index.");
  await c.query("begin");
  try {
    const event = await first(
      c,
      "insert into chain_events(chain_id,contract_address,transaction_hash,log_index,block_number,block_hash,name,payload_json,finality_state) values('5042002',$1,$2,$3,$4,$5,'BountyFunded',$6,'FINAL') on conflict(chain_id,transaction_hash,log_index) do update set updated_at=now() returning id",
      [
        policy.escrow,
        receipt.hash,
        logIndex,
        receipt.blockNumber.toString(),
        receipt.blockHash,
        JSON.stringify({
          bountyId: row.policy_hash,
          organizationId: policy.organizationId,
          reward: policy.reward,
          asset: policy.asset,
          policyHash: row.policy_hash,
        }),
      ],
    );
    await c.query(
      "insert into bounties(bounty_id,program_id,severity_tier_id,policy_hash,policy_json,chain_id,escrow,reward,unallocated_reward,chain_state,creation_tx,last_event_key) values($1,$2,$8,$1,$3,'5042002',$4,$5,$5,'FUNDED',$6,$7) on conflict(bounty_id) do nothing",
      [
        row.policy_hash,
        row.program_id,
        JSON.stringify(policy),
        policy.escrow,
        policy.reward,
        receipt.hash,
        event.id,
        row.severity_tier_id,
      ],
    );
    await c.query(
      "insert into receipts(organization_id,bounty_id,category,amount,asset,event_id,status) values($1,$2,'FUNDING',$3,$4,$5,'FINAL') on conflict(event_id,category) do nothing",
      [row.organization_id, row.policy_hash, policy.reward, policy.asset, event.id],
    );
    await c.query(
      "update funding_requests set state='FUNDED',failure_code=null,version=version+1,updated_at=now() where id=$1",
      [row.id],
    );
    await c.query(
      "insert into outbox(deduplication_key,event_type,aggregate_id,payload_json) values($1,'COVERAGE_REFRESH',$2,$3) on conflict(deduplication_key) do nothing",
      [
        `funded-coverage:${row.id}`,
        row.organization_id,
        JSON.stringify({ organizationId: row.organization_id }),
      ],
    );
    await c.query("commit");
  } catch (error) {
    await c.query("rollback");
    throw error;
  }
}
