import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import { createServer as httpServer } from "node:http";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { createPublicClient, http } from "viem";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ReadOnlyBountyChain } from "../packages/chain/src/bounty-reader.ts";
import { connectDatabase, databaseUrl } from "../packages/database/src/index.ts";
import { policySchema } from "../packages/domain/src/index.ts";
import { localSeedScope } from "../scripts/local-seed-scope.ts";
import { createApp } from "../services/api/src/app.ts";
import { LocalAuthProvider } from "../services/api/src/auth.ts";

const name = `proofofhack_seed_test_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
const url = new URL(databaseUrl());
url.pathname = `/${name}`;
let rpc: string, anvil: ChildProcess | undefined;
const admin = connectDatabase().pool;
const directory = resolve(".local/seeds", name);
async function run(rpcUrl: string, args: string[] = []) {
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/seed-local.ts", ...args], {
    env: {
      ...process.env,
      APP_ENV: "local",
      LOCAL_RPC_URL: rpcUrl,
      LOCAL_SEED_DATABASE_URL: url.toString(),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 25000);
  try {
    const code = await new Promise<number | null>((done, reject) => {
      child.once("error", reject);
      child.once("exit", done);
    });
    return { code, output };
  } finally {
    clearTimeout(timer);
  }
}
beforeAll(async () => {
  const port = await new Promise<number>((done, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string")
        return reject(new Error("Port allocation failed."));
      server.close(() => done(address.port));
    });
  });
  rpc = `http://127.0.0.1:${port}`;
  localSeedScope({ APP_ENV: "local", LOCAL_RPC_URL: rpc, LOCAL_SEED_DATABASE_URL: url.toString() });
  anvil = spawn(
    "anvil",
    [
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--chain-id",
      "31337",
      "--prune-history",
      "4096",
      "--silent",
    ],
    { stdio: "ignore" },
  );
  let startupError = false;
  anvil.once("error", () => {
    startupError = true;
  });
  const client = createPublicClient({ transport: http(rpc, { retryCount: 0, timeout: 200 }) });
  for (let attempt = 0; attempt < 50; attempt++) {
    if (startupError) throw new Error("Anvil could not start.");
    try {
      if ((await client.getChainId()) === 31337) return;
    } catch {
      /* Wait for this child. */
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Anvil did not become ready.");
});
afterAll(async () => {
  anvil?.kill("SIGTERM");
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
  await rm(directory, { recursive: true, force: true });
});
it("Refuses a non-local chain before creating a database or sending a transaction", async () => {
  const methods: string[] = [];
  const server = httpServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      const data = JSON.parse(body);
      methods.push(data.method);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: data.id, result: "0x1" }));
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Port unavailable.");
    const result = await run(`http://127.0.0.1:${address.port}`);
    expect(result.code).toBe(1);
    expect(result.output).toContain("refuses every chain");
    expect(methods).toEqual(["eth_chainId"]);
    expect((await admin.query("select 1 from pg_database where datname=$1", [name])).rowCount).toBe(
      0,
    );
    await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
}, 30000);
it("Creates final local funding, separate actors, private files, and refuses a repeated seed", async () => {
  expect((await run(rpc, ["--check"])).code).toBe(0);
  expect((await admin.query("select 1 from pg_database where datname=$1", [name])).rowCount).toBe(
    0,
  );
  const result = await run(rpc);
  expect(result.output).not.toMatch(/privateKey|Bearer|postgres:\/\//);
  expect(result, result.output).toMatchObject({ code: 0 });
  const manifest = JSON.parse(await readFile(resolve(directory, "seed.json"), "utf8"));
  expect(manifest).toMatchObject({ chainId: 31337, synthetic: true, liveSponsorEvidence: false });
  expect(manifest.bounties).toHaveLength(3);
  const database = connectDatabase(url.toString());
  const actors = JSON.parse(await readFile(resolve(directory, "actors.json"), "utf8"));
  const app = await createApp({
    pool: database.pool,
    auth: new LocalAuthProvider(actors, "local"),
    appEnv: "local",
    webOrigin: "http://127.0.0.1:5173",
  });
  try {
    for (const bounty of manifest.bounties) {
      const snapshot = await new ReadOnlyBountyChain(rpc, 31337, manifest.escrow).read(
        policySchema.parse(bounty.policy),
      );
      expect(snapshot.state).toBe(1);
      expect(snapshot.unallocatedReward).toBe(1000000n);
    }
    const counts = await database.pool.query(
      "select (select count(*)::int from bounties) bounties,(select count(*)::int from receipts where status='FINAL') receipts,(select count(*)::int from users) users",
    );
    expect(counts.rows[0]).toEqual({ bounties: 3, receipts: 3, users: 5 });
    for (let i = 0; i < 5; i++) {
      const response = await app.inject({
        url: `/api/v1/organizations/${manifest.organizationId}`,
        headers: { authorization: `Bearer ${actors[i].token}` },
      });
      expect(response.statusCode).toBe(i < 3 ? 200 : 404);
    }
    for (const path of ["actors.json", "runtime.json", "verifier-secrets.json", "seed.json"])
      expect((await stat(resolve(directory, path))).mode & 0o077).toBe(0);
    const client = createPublicClient({ transport: http(rpc), cacheTime: 0 });
    const before = await client.getBlockNumber();
    const repeated = await run(rpc);
    expect(repeated.code).toBe(1);
    expect(repeated.output).toContain("database already exists");
    expect(await client.getBlockNumber()).toBe(before);
    expect((await database.pool.query("select count(*)::int n from bounties")).rows[0].n).toBe(3);
  } finally {
    await app.close();
    await database.pool.end();
  }
}, 30000);
