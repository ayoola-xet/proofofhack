import { getCreate2Address, type Hex, parseAbi, parseEventLogs } from "viem";
import { DomainError } from "../../domain/src/index.ts";
import bytecode from "./bytecode/FundingBudgetController.json" with { type: "json" };
import type { FundingReceipt } from "./funding.ts";

export const circleArcFactory = {
  address: "0xa3039a54856ed74b5aec999eef3fc954ab010cf6" as Hex,
  runtimeCodeHash: "0x6ceb9d3b4b7d218f5eec7f87313dc82ca3a01f01d3ff7a50757177a776bbb496" as Hex,
};
export type DeploymentFactory = typeof circleArcFactory;
const factoryAbi = parseAbi(["event ContractDeployed(address indexed addr, bytes32 salt)"]);

export function factoryCreationProof(
  receipt: FundingReceipt,
  creationCode: Hex,
  contract: Hex,
  factory: DeploymentFactory,
) {
  const events = parseEventLogs({
    abi: factoryAbi,
    eventName: "ContractDeployed",
    logs: receipt.logs.filter((l) => l.address.toLowerCase() === factory.address),
    strict: true,
  }).filter((e) => e.args.addr.toLowerCase() === contract.toLowerCase());
  if (
    events.length !== 1 ||
    getCreate2Address({
      from: factory.address,
      salt: events[0].args.salt,
      bytecode: creationCode,
    }).toLowerCase() !== contract.toLowerCase()
  )
    throw new DomainError(
      "CONTROLLER_CODE_MISMATCH",
      "The factory event does not bind the exact controller code and constructor.",
    );
  return {
    factory: factory.address,
    factoryCodeHash: factory.runtimeCodeHash,
    salt: events[0].args.salt,
    deploymentLogIndex: events[0].logIndex,
  };
}

export function matchesControllerRuntime(code: Hex) {
  if (code.length !== bytecode.runtimeTemplate.length) return false;
  const mask = (value: string) => {
    let masked = value.toLowerCase();
    for (const { start, length } of bytecode.immutableReferences)
      masked =
        masked.slice(0, 2 + start * 2) +
        "0".repeat(length * 2) +
        masked.slice(2 + (start + length) * 2);
    return masked;
  };
  return mask(code) === mask(bytecode.runtimeTemplate);
}
