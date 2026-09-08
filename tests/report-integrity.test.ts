import { keccak256 } from "viem";
import { describe, expect, it } from "vitest";
import { verifyReportBytes } from "../packages/report-integrity/src/index.ts";

describe("Report download integrity (PRI-05)", () => {
  it("accepts the exact bytes and rejects a changed byte or wrong commitment", () => {
    const bytes = new TextEncoder().encode(
      '{"evidenceScope":"FIXTURE_ONLY","outcome":"QUALIFIES"}',
    );
    const hash = keccak256(bytes);
    expect(() => verifyReportBytes(bytes, hash)).not.toThrow();
    const changed = bytes.slice();
    changed[changed.length - 2] ^= 1;
    expect(() => verifyReportBytes(changed, hash)).toThrow("does not match");
    expect(() => verifyReportBytes(bytes, `0x${"0".repeat(64)}`)).toThrow("does not match");
    expect(() => verifyReportBytes(bytes, "")).toThrow("does not match");
  });
});
