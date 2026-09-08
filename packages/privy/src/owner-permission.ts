import type { Hex } from "viem";
import { type OwnerCommand, ownerCall } from "../../chain/src/owner-command.ts";
import { type TreasuryConfiguration, treasuryRules } from "./treasury.ts";

export type OwnerPermission = { controller: Hex; command: OwnerCommand; expiresAt: string };
export function ownerPermissionRules(config: TreasuryConfiguration, permission: OwnerPermission) {
  if (!Number.isFinite(Date.parse(permission.expiresAt)))
    throw new Error("The owner permission requires an expiry time.");
  const call = ownerCall(permission.controller, permission.command);
  const abi = JSON.parse(
    JSON.stringify(
      call.abi.filter((item) => item.type === "function" && item.name === call.functionName),
    ),
  );
  const rules = treasuryRules(config);
  rules.push({
    name: "One confirmed controller owner action",
    action: "ALLOW",
    method: "eth_signTransaction",
    conditions: [
      { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: "5042002" },
      { field_source: "ethereum_transaction", field: "value", operator: "eq", value: "0" },
      { field_source: "ethereum_transaction", field: "to", operator: "eq", value: call.to },
      {
        field_source: "system",
        field: "current_unix_timestamp",
        operator: "lt",
        value: String(Math.floor(Date.parse(permission.expiresAt) / 1000)),
      },
      {
        field_source: "ethereum_calldata",
        field: "function_name",
        operator: "eq",
        value: call.functionName,
        abi,
      },
      ...Object.entries(permission.command.kind === "SET_ENABLED" ? {} : call.fields).map(
        ([field, value]) => ({
          field_source: "ethereum_calldata" as const,
          field: `${call.functionName}.${field}`,
          operator: "eq" as const,
          value,
          abi,
        }),
      ),
    ],
  });
  return rules;
}
