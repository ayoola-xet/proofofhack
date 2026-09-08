import { encodeAbiParameters, keccak256, parseAbiParameters, toHex } from "viem";
import type { Fixture } from "./index.ts";
export const FIXTURE_LEAF_TYPEHASH = keccak256(
  toHex("FixtureLeafV1(bytes32 caseId,uint256 expectedAssets,uint256 observedAssets,bytes32 salt)"),
);
export const leafHash = (fixture: Fixture) =>
  keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32, bytes32, uint256, uint256, bytes32"), [
      FIXTURE_LEAF_TYPEHASH,
      fixture.caseId,
      BigInt(fixture.expectedAssets),
      BigInt(fixture.observedAssets),
      fixture.salt,
    ]),
  );
