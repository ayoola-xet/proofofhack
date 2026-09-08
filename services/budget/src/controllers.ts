import type { Pool, PoolClient } from "pg";
import type { Hex } from "viem";
import type {
  BudgetChain,
  ControllerBinding,
  ControllerSnapshot,
} from "../../../packages/chain/src/budget.ts";
import { address, bytes32, DomainError, policySchema } from "../../../packages/domain/src/index.ts";
import { first } from "../../api/src/context.ts";

type Database = Pick<Pool | PoolClient, "query">;
const zero = `0x${"0".repeat(64)}` as Hex;
export async function controllerContext(db: Database, controllerId: string) {
  const row = await first(
    db,
    `select c.*,o.onchain_id,ow.address as owner_address,ow.owner_id,ow.owner_type,ow.provider as owner_provider,
    op.address as operator_address,op.owner_type as operator_owner_type,op.provider as operator_provider
    from budget_controllers c join organizations o on o.id=c.organization_id join wallets ow on ow.id=c.owner_wallet_id join wallets op on op.id=c.operator_wallet_id where c.id=$1`,
    [controllerId],
  );
  if (
    row.owner_type !== "ORGANIZATION" ||
    row.owner_id !== row.organization_id ||
    row.owner_provider !== "PRIVY" ||
    row.operator_provider !== "CIRCLE" ||
    row.operator_owner_type !== "SERVICE"
  )
    throw new DomainError(
      "CONTROLLER_WALLET_MISMATCH",
      "The controller wallets do not match their required owners.",
    );
  const binding: ControllerBinding = {
    chainId: Number(row.chain_id),
    address: address.parse(row.address),
    owner: address.parse(row.owner_address),
    operator: address.parse(row.operator_address),
    organizationId: bytes32.parse(row.onchain_id),
    asset: address.parse(row.asset),
    escrow: address.parse(row.limit_projection_json.escrow),
  };
  return { row, binding };
}
function projection(state: ControllerSnapshot) {
  return {
    enabled: state.enabled,
    perActionLimit: String(state.perActionLimit),
    dailyLimit: String(state.dailyLimit),
    minimumInterval: String(state.minimumInterval),
    lastAllocation: String(state.lastAllocation),
    spentToday: String(state.spentToday),
    balance: String(state.balance),
    operatorGasBalance: String(state.operatorGasBalance),
    blockNumber: String(state.blockNumber),
    blockHash: state.blockHash,
    timestamp: String(state.timestamp),
  };
}
export async function registerController(
  db: Database,
  chain: BudgetChain,
  input: {
    organizationId: string;
    ownerWalletId: string;
    operatorWalletId: string;
    address: Hex;
    deploymentHash: Hex;
  },
  network: { chainId: number; asset: Hex; escrow: Hex; operator: Hex },
) {
  const org = await first(
    db,
    "select onchain_id from organizations where id=$1 and status='ACTIVE'",
    [input.organizationId],
  );
  const owner = await first(
    db,
    "select address from wallets where id=$1 and owner_type='ORGANIZATION' and owner_id=$2 and provider='PRIVY' and chain_id=$3",
    [input.ownerWalletId, input.organizationId, String(network.chainId)],
  );
  const operator = await first(
    db,
    "select address from wallets where id=$1 and owner_type='SERVICE' and provider='CIRCLE' and chain_id=$2",
    [input.operatorWalletId, String(network.chainId)],
  );
  if (operator.address !== network.operator)
    throw new DomainError("OPERATOR_MISMATCH", "Use the configured Circle service wallet.");
  const binding: ControllerBinding = {
    ...network,
    address: input.address,
    owner: owner.address,
    organizationId: org.onchain_id,
  };
  const proof = await chain.verifyDeployment(binding, input.deploymentHash),
    state = await chain.read(binding, zero);
  await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
    `controller-org:${input.organizationId}`,
  ]);
  const existing = (
    await db.query("select * from budget_controllers where organization_id=$1 and chain_id=$2", [
      input.organizationId,
      String(network.chainId),
    ])
  ).rows[0];
  if (existing) {
    if (
      existing.address !== input.address ||
      existing.owner_wallet_id !== input.ownerWalletId ||
      existing.operator_wallet_id !== input.operatorWalletId
    )
      throw new DomainError(
        "CONTROLLER_EXISTS",
        "This organization already has a different controller.",
      );
    return existing;
  }
  return first(
    db,
    "insert into budget_controllers(organization_id,chain_id,address,owner_wallet_id,operator_wallet_id,asset,enabled,limit_projection_json) values($1,$2,$3,$4,$5,$6,$7,$8) returning *",
    [
      input.organizationId,
      String(network.chainId),
      input.address,
      input.ownerWalletId,
      input.operatorWalletId,
      network.asset,
      state.enabled,
      JSON.stringify({ escrow: network.escrow, deploymentProof: proof, ...projection(state) }),
    ],
  );
}
export async function syncController(db: Database, chain: BudgetChain, controllerId: string) {
  const { binding } = await controllerContext(db, controllerId),
    state = await chain.read(binding, zero);
  await db.query(
    "update budget_controllers set enabled=$2,limit_projection_json=limit_projection_json || $3::jsonb,updated_at=now(),version=version+1 where id=$1",
    [controllerId, state.enabled, JSON.stringify(projection(state))],
  );
  return { binding, state };
}
export async function syncApproval(
  db: Database,
  chain: BudgetChain,
  controllerId: string,
  draftId: string,
) {
  const { row, binding } = await controllerContext(db, controllerId);
  const draft = await first(
    db,
    "select d.* from bounty_drafts d join programs p on p.id=d.program_id where d.id=$1 and p.organization_id=$2 and d.status='APPROVED'",
    [draftId, row.organization_id],
  );
  const policy = policySchema.parse(draft.policy_json);
  if (
    policy.refundRecipient !== binding.address ||
    policy.organizationId !== binding.organizationId ||
    policy.asset !== binding.asset ||
    Number(policy.settlementChainId) !== binding.chainId ||
    policy.escrow !== binding.escrow
  )
    throw new DomainError(
      "ALLOCATION_POLICY_MISMATCH",
      "The approved draft does not return unallocated funds to this controller.",
    );
  const state = await chain.read(binding, bytes32.parse(draft.policy_hash));
  if (
    state.approval.consumed ||
    state.approval.reward !== BigInt(policy.reward) ||
    state.approval.expiresAt <= state.timestamp
  )
    throw new DomainError(
      "POLICY_NOT_APPROVED",
      "The controller has no current, unconsumed approval for this exact policy.",
    );
  const allocation = await first(
    db,
    "insert into approved_allocations(controller_id,policy_hash,reward,expires_at) values($1,$2,$3,$4) on conflict(controller_id,policy_hash) do update set reward=excluded.reward,expires_at=excluded.expires_at,updated_at=now() where approved_allocations.consumed_event_ref is null returning *",
    [
      controllerId,
      draft.policy_hash,
      policy.reward,
      new Date(Number(state.approval.expiresAt) * 1000),
    ],
  );
  return allocation;
}
