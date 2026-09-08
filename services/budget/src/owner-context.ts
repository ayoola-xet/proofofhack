import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { ARC_USDC } from "../../../packages/chain/src/arc.ts";
import type { ControllerBinding } from "../../../packages/chain/src/budget.ts";
import {
  type OwnerCommand,
  ownerCommandSchema,
} from "../../../packages/chain/src/owner-command.ts";
import {
  address,
  bytes32,
  DomainError,
  hashPolicy,
  policySchema,
} from "../../../packages/domain/src/index.ts";
import type { TreasuryWallet } from "../../../packages/privy/src/treasury.ts";
import { first } from "../../api/src/context.ts";
import { controllerContext } from "./controllers.ts";

type Database = Pick<Pool | PoolClient, "query">;
export async function ownerContext(db: Database, controllerId: string) {
  const { row: controller, binding } = await controllerContext(db, controllerId);
  const setup = await first(
    db,
    "select s.*,w.provider_wallet_id,w.address from wallet_setups s join wallets w on w.id=s.wallet_id where s.wallet_id=$1 and s.organization_id=$2",
    [controller.owner_wallet_id, controller.organization_id],
  );
  const config = z
    .strictObject({
      organizationId: bytes32,
      escrow: address,
      maxPerAction: z.string().regex(/^[1-9][0-9]*$/),
    })
    .parse(setup.configuration_json);
  if (
    binding.chainId !== 5042002 ||
    binding.asset !== ARC_USDC ||
    binding.escrow !== config.escrow ||
    binding.organizationId !== config.organizationId ||
    setup.address !== binding.owner ||
    setup.max_per_action !== config.maxPerAction
  )
    throw new DomainError(
      "OWNER_WALLET_SCOPE",
      "The controller owner wallet configuration differs from the registered controller.",
    );
  const wallet: TreasuryWallet = {
    id: setup.provider_wallet_id,
    address: binding.owner,
    ownerId: setup.owner_id,
    policyIds: [setup.provider_policy_id],
  };
  return { controller, binding, setup, config, wallet };
}

export async function validateOwnerCommand(
  db: Database,
  organizationId: string,
  binding: ControllerBinding,
  maxPerAction: string,
  input: OwnerCommand,
  checkExpiry = true,
) {
  const command = ownerCommandSchema.parse(input),
    cap = BigInt(maxPerAction),
    now = BigInt(Math.floor(Date.now() / 1000));
  if (
    (command.kind === "SET_LIMITS" && BigInt(command.perAction) > cap) ||
    (command.kind === "DEPOSIT" && BigInt(command.amount) > cap) ||
    (command.kind === "APPROVE_POLICY" && BigInt(command.reward) > cap)
  )
    throw new DomainError(
      "OWNER_AMOUNT_CAP",
      "The action exceeds the organization wallet amount cap.",
    );
  if (command.kind === "APPROVE_POLICY") {
    const row = await first(
      db,
      "select d.* from bounty_drafts d join programs p on p.id=d.program_id where d.id=$1 and p.organization_id=$2 and p.status='ACTIVE' and d.status='APPROVED' and d.approved_by is not null",
      [command.draftId, organizationId],
    );
    const policy = policySchema.parse(row.policy_json);
    if (
      hashPolicy(policy) !== command.policyHash ||
      row.policy_hash !== command.policyHash ||
      policy.reward !== command.reward ||
      policy.refundRecipient !== binding.address ||
      policy.organizationId !== binding.organizationId ||
      policy.escrow !== binding.escrow ||
      policy.asset !== binding.asset ||
      policy.settlementChainId !== String(binding.chainId)
    )
      throw new DomainError(
        "OWNER_POLICY_SCOPE",
        "Select the exact approved policy for this controller.",
      );
    if (
      BigInt(command.expiresAt) > BigInt(policy.submissionDeadline) ||
      (checkExpiry &&
        (BigInt(command.expiresAt) <= now + 60n || BigInt(command.expiresAt) > now + 2592000n))
    )
      throw new DomainError(
        "OWNER_APPROVAL_EXPIRY",
        "Use an approval expiry before the bounty deadline and within thirty days.",
      );
  }
  return command;
}
