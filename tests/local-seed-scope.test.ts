import { expect, it } from "vitest";
import { localSeedScope } from "../scripts/local-seed-scope.ts";

const local = {
  APP_ENV: "local",
  LOCAL_RPC_URL: "http://127.0.0.1:8545",
  LOCAL_SEED_DATABASE_URL: "postgres://test:test@127.0.0.1:5433/vulnproof_seed_demo",
};
it("Requires explicit local chain and separate database scope", () => {
  expect(localSeedScope(local).name).toBe("vulnproof_seed_demo");
  expect(() => localSeedScope({})).toThrow();
  expect(() => localSeedScope({ ...local, APP_ENV: "arc-testnet" })).toThrow();
  for (const rpc of [
    "https://rpc.testnet.arc.io",
    "http://localhost:8545",
    "http://127.0.0.1:8545/proxy",
    "http://127.0.0.1:8545?target=remote",
    "http://user:secret@127.0.0.1:8545",
  ])
    expect(() => localSeedScope({ ...local, LOCAL_RPC_URL: rpc })).toThrow();
});
it("Rejects shared databases, remote hosts, connection overrides, and SQL identifiers", () => {
  for (const url of [
    "postgres://test@127.0.0.1:5433/vulnproof",
    "postgres://test@example.com:5433/vulnproof_seed_demo",
    "postgres://test@127.0.0.1:5433/vulnproof_seed_demo?host=example.com",
    "postgres://test@127.0.0.1:5433/vulnproof_seed_demo%22",
    "postgres://test@127.0.0.1:5433/vulnproof_seed_demo#x",
  ])
    expect(() => localSeedScope({ ...local, LOCAL_SEED_DATABASE_URL: url })).toThrow();
});
