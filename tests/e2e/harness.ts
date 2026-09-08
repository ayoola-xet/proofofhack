import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createServer as netServer } from "node:net";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import type { FastifyInstance } from "fastify";
import { PgBoss } from "pg-boss";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  type Hex,
  http,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type ViteDevServer, createServer as viteServer } from "vite";
import { z } from "zod";
import { ReadOnlyBountyChain } from "../../packages/chain/src/bounty-reader.ts";
import { encodeClaimCall } from "../../packages/chain/src/claim-calls.ts";
import { FileCiphertextStore } from "../../packages/ciphertext-store/src/index.ts";
import { connectDatabase, databaseUrl } from "../../packages/database/src/index.ts";
import { policySchema } from "../../packages/domain/src/index.ts";
import { InternalClient } from "../../packages/service-auth/src/http.ts";
import { publicConfigSchema } from "../../packages/service-config/src/index.ts";
import { localSeedScope } from "../../scripts/local-seed-scope.ts";
import { createApp } from "../../services/api/src/app.ts";
import { LocalAuthProvider } from "../../services/api/src/auth.ts";
import { createReleaseApp } from "../../services/report-release/src/app.ts";
import { createReportDownloadApp } from "../../services/report-release/src/download.ts";
import { OrganizationKeyStore } from "../../services/report-release/src/keys.ts";
import { createVerifierApp } from "../../services/verifier/src/app.ts";
import { FixtureVerifier } from "../../services/verifier/src/process.ts";
import { startClaimJobs } from "../../services/worker/src/claim-jobs.ts";
import type { ClaimRelayer } from "../../services/worker/src/claim-process.ts";

const seedSchema = z.object({
  organizationId: z.uuid(),
  programId: z.uuid(),
  escrow: z.custom<Hex>(),
  asset: z.custom<Hex>(),
  wallets: z.array(
    z.object({ role: z.string(), userId: z.uuid(), walletId: z.uuid(), address: z.string() }),
  ),
  bounties: z.array(z.object({ label: z.string(), bountyId: z.string(), policy: policySchema })),
});
const actorSchema = z.array(
  z.object({
    role: z.string(),
    privateKey: z.custom<Hex>(),
    token: z.string(),
    subject: z.string(),
    displayName: z.string(),
  }),
);
async function port() {
  return new Promise<number>((done, reject) => {
    const server = netServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Port unavailable."));
      server.close(() => done(address.port));
    });
  });
}
export async function startBrowserHarness() {
  const name = `vulnproof_seed_e2e_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  const database = new URL(databaseUrl());
  database.pathname = `/${name}`;
  const rpc = `http://127.0.0.1:${await port()}`;
  localSeedScope({
    APP_ENV: "local",
    LOCAL_RPC_URL: rpc,
    LOCAL_SEED_DATABASE_URL: database.toString(),
  });
  const directory = resolve(".local/seeds", name);
  const admin = connectDatabase().pool;
  const { pool } = connectDatabase(database.toString());
  const apps: FastifyInstance[] = [];
  let anvil: ChildProcess | undefined, vite: ViteDevServer | undefined, boss: PgBoss | undefined;
  let unblockPayment = () => {};
  let paymentStopped = false;
  const blockedServerRequests: string[] = [];
  const queueErrors: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (!["127.0.0.1", "[::1]"].includes(url.hostname)) {
      blockedServerRequests.push(url.origin);
      throw new Error("External requests are disabled in the local browser harness.");
    }
    return originalFetch(input, init);
  };
  async function stop() {
    unblockPayment();
    await boss?.stop({ graceful: true, timeout: 20000 });
    await vite?.close();
    await Promise.all(apps.map((app) => app.close()));
    anvil?.kill("SIGTERM");
    await pool.end();
    await admin.query(`drop database if exists "${name}"`);
    await admin.end();
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
  try {
    anvil = spawn(
      "anvil",
      [
        "--host",
        "127.0.0.1",
        "--port",
        new URL(rpc).port,
        "--chain-id",
        "31337",
        "--prune-history",
        "4096",
        "--silent",
      ],
      { stdio: "ignore" },
    );
    let startFailed = false;
    anvil.once("error", () => {
      startFailed = true;
    });
    const client = createPublicClient({
      transport: http(rpc, { retryCount: 0, timeout: 1000 }),
      pollingInterval: 50,
    });
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      if (startFailed) throw new Error("Anvil could not start.");
      try {
        ready = (await client.getChainId()) === 31337;
        if (ready) break;
      } catch {
        /* This child is starting. */
      }
      await new Promise((done) => setTimeout(done, 100));
    }
    if (!ready) throw new Error("The local chain did not start.");
    const seedProcess = spawn(process.execPath, ["--import", "tsx", "scripts/seed-local.ts"], {
      env: {
        ...process.env,
        APP_ENV: "local",
        LOCAL_RPC_URL: rpc,
        LOCAL_SEED_DATABASE_URL: database.toString(),
      },
      stdio: "ignore",
    });
    const timer = setTimeout(() => seedProcess.kill("SIGKILL"), 30000);
    try {
      const code = await new Promise((done, reject) => {
        seedProcess.once("error", reject);
        seedProcess.once("exit", done);
      });
      if (code !== 0) throw new Error("The local browser seed failed.");
    } finally {
      clearTimeout(timer);
    }
    const load = async (file: string) =>
      JSON.parse(await readFile(resolve(directory, file), "utf8"));
    const seed = seedSchema.parse(await load("seed.json")),
      actors = actorSchema.parse(await load("actors.json"));
    const config = publicConfigSchema.parse(await load("public-services.json"));
    const secrets = await load("verifier-secrets.json");
    const workerIdentity = await load("worker-identity.json"),
      apiIdentity = await load("api-identity.json");
    const evidence = new FileCiphertextStore(resolve(directory, "evidence"), 262192),
      reports = new FileCiphertextStore(resolve(directory, "reports"), 1048576);
    const reader = new ReadOnlyBountyChain(rpc, 31337, seed.escrow);
    const auth = new LocalAuthProvider(actors, "local");
    const keys = new OrganizationKeyStore(resolve(directory, "organization-keys"));
    const listen = async (app: FastifyInstance) => {
      apps.push(app);
      return app.listen({ port: 0, host: "127.0.0.1" });
    };
    const releaseUrl = await listen(
      createReleaseApp(
        pool,
        { api: config.serviceIdentities.api, worker: config.serviceIdentities.worker },
        resolve(directory, "organization-keys"),
      ),
    );
    const verifierUrl = await listen(
      createVerifierApp(
        new FixtureVerifier(pool, { config, evidence, reports, reader, ...secrets }),
        config.serviceIdentities.worker,
      ),
    );
    const researcherUrl = await listen(
      createReportDownloadApp({
        pool,
        auth,
        mode: "researcher",
        store: reports,
        resolveKey: async () => secrets.researcherKeys,
      }),
    );
    const organizationUrl = await listen(
      createReportDownloadApp({
        pool,
        auth,
        mode: "organization",
        store: reports,
        resolveKey: async (id, org) => {
          const key = await keys.read(id);
          if (key.organizationId !== org) throw new Error("Organization key mismatch.");
          return key;
        },
      }),
    );
    const webPort = await port(),
      baseUrl = `http://127.0.0.1:${webPort}`;
    const apiUrl = await listen(
      await createApp({
        pool,
        auth,
        appEnv: "local",
        webOrigin: baseUrl,
        claimServices: { config, evidence },
        recoveryChain: reader,
        bountyServices: {
          escrow: seed.escrow,
          publicConfig: config,
          release: new InternalClient(releaseUrl, "api", "report-release", apiIdentity.privateKey),
        },
        walletIdentity: {
          userWallets: async (subject) => {
            const index = actors.findIndex((actor) => actor.subject === subject);
            if (index < 0) return [];
            return [
              {
                providerWalletId: `local-seed:${name}:${actors[index].role}`,
                address: seed.wallets[index].address,
              },
            ];
          },
        },
      }),
    );
    const operator = privateKeyToAccount(actors[0].privateKey);
    const chain = defineChain({
      id: 31337,
      name: "Local browser test",
      nativeCurrency: { name: "Local ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpc] } },
    });
    const wallet = createWalletClient({
      account: operator,
      chain,
      transport: http(rpc),
      pollingInterval: 50,
    });
    const relayerId = (
      await pool.query(
        "insert into wallets(provider,provider_wallet_id,owner_type,owner_id,chain_id,address) values('CIRCLE',$1,'SERVICE',$2,'31337',$3) returning id",
        [`local-browser:${name}`, seed.wallets[0].userId, operator.address.toLowerCase()],
      )
    ).rows[0].id;
    const paymentGate = new Promise<void>((done) => {
      unblockPayment = done;
    });
    const relayer: ClaimRelayer = {
      walletId: relayerId,
      send: async (_key, escrow, call, requestId) => {
        if (call.method === "collectPayment") {
          paymentStopped = true;
          await paymentGate;
        }
        if (escrow !== seed.escrow || (await client.getChainId()) !== 31337)
          throw new Error("Local transaction scope mismatch.");
        const file = resolve(directory, `${z.uuid().parse(requestId)}.transaction.json`);
        let saved: { raw: Hex; hash: Hex };
        try {
          saved = JSON.parse(await readFile(file, "utf8"));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          const transaction = await wallet.prepareTransactionRequest({
            to: escrow,
            data: encodeClaimCall(call),
            value: 0n,
          });
          const raw = await wallet.signTransaction(transaction);
          saved = { raw, hash: keccak256(raw) };
          await writeFile(file, JSON.stringify(saved), { mode: 0o600, flag: "wx" });
        }
        let mined = await client.getTransactionReceipt({ hash: saved.hash }).catch(() => null);
        if (!mined) {
          await wallet.sendRawTransaction({ serializedTransaction: saved.raw });
          mined = await client.waitForTransactionReceipt({ hash: saved.hash, timeout: 15000 });
        }
        if (mined.status !== "success") throw new Error("The local claim transaction reverted.");
        const response = await fetch(rpc, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_mine", params: ["0x40"] }),
        });
        if ((await response.json()).error) throw new Error("Local finality advancement failed.");
        return { hash: saved.hash, providerId: `local:${requestId}` };
      },
    };
    boss = new PgBoss(database.toString());
    boss.on("error", () => {
      queueErrors.push("QUEUE_ERROR");
    });
    await boss.start();
    await startClaimJobs(
      boss,
      pool,
      reader,
      relayer,
      new InternalClient(verifierUrl, "worker", "verifier", workerIdentity.privateKey),
      new InternalClient(releaseUrl, "worker", "report-release", workerIdentity.privateKey),
    );
    vite = await viteServer({
      configFile: false,
      root: resolve("apps/web"),
      envDir: false,
      cacheDir: resolve(directory, "vite-cache"),
      logLevel: "error",
      plugins: [react()],
      define: { "import.meta.env.VITE_PRIVY_APP_ID": JSON.stringify("local-browser-test") },
      resolve: {
        alias: [
          { find: /^@privy-io\/react-auth$/, replacement: resolve("tests/e2e/privy-local.tsx") },
        ],
      },
      server: {
        host: "127.0.0.1",
        port: webPort,
        strictPort: true,
        fs: { allow: [process.cwd()] },
        proxy: {
          "/api": apiUrl,
          "/private/researcher": researcherUrl,
          "/private/organization": organizationUrl,
        },
      },
    });
    await vite.listen();
    return {
      seed,
      actors,
      pool,
      client,
      reader,
      baseUrl,
      directory,
      fixtures: (await load("fixtures.json")) as {
        fixtures: { label: string; fixture: Record<string, unknown> }[];
      },
      dispatch: () => boss?.send("claim-dispatch"),
      paymentStopped: () => paymentStopped,
      allowPayment: () => unblockPayment(),
      blockedServerRequests,
      queueErrors,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
