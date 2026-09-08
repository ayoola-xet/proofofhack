import { ARC_USDC } from "../../../packages/chain/src/arc.ts";
import { ReadOnlyBountyChain } from "../../../packages/chain/src/bounty-reader.ts";
import { ReadOnlyBudgetChain } from "../../../packages/chain/src/budget.ts";
import { FileCiphertextStore } from "../../../packages/ciphertext-store/src/index.ts";
import { address } from "../../../packages/domain/src/index.ts";
import { InternalClient } from "../../../packages/service-auth/src/http.ts";
import { loadPublicConfig, loadTestnetSecret } from "../../../packages/service-config/src/index.ts";
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { createRemoteJWKSet } from "jose";
import { z } from "zod";
import { connectDatabase } from "../../../packages/database/src/index.ts";
import { PrivyWalletIdentity } from "../../../packages/privy/src/wallets.ts";
import { createApp } from "./app.ts";
import { LocalAuthProvider, PrivyAuthProvider } from "./auth.ts";

const appEnv = z.enum(["local", "arc-testnet"]).parse(process.env.APP_ENV);
const { pool } = connectDatabase();
const localPath = process.env.LOCAL_AUTH_FILE;
const auth =
  localPath && appEnv === "local"
    ? new LocalAuthProvider(
        z
          .array(
            z.strictObject({ token: z.string(), subject: z.string(), displayName: z.string() }),
          )
          .parse(JSON.parse(await readFile(localPath, "utf8"))),
        appEnv,
      )
    : new PrivyAuthProvider(
        z.string().min(1).parse(process.env.PRIVY_APP_ID),
        process.env.PRIVY_VERIFICATION_KEY ||
          createRemoteJWKSet(
            new URL(
              `https://auth.privy.io/api/v1/apps/${z
                .string()
                .regex(/^[a-z0-9]+$/)
                .parse(process.env.PRIVY_APP_ID)}/jwks.json`,
            ),
          ),
      );
const bountyServices =
  process.env.SERVICE_PUBLIC_CONFIG && process.env.ESCROW_ADDRESS
    ? {
        publicConfig: await loadPublicConfig(process.env.SERVICE_PUBLIC_CONFIG),
        escrow: address.parse(process.env.ESCROW_ADDRESS),
        release: new InternalClient(
          process.env.REPORT_INTERNAL_URL ?? "http://127.0.0.1:4194",
          "api",
          "report-release",
          z
            .string()
            .startsWith("-----BEGIN PRIVATE KEY-----")
            .parse(
              (
                await loadTestnetSecret(
                  process.env.API_IDENTITY_KEY ?? ".local/keys/api-identity.json",
                )
              ).privateKey,
            ),
        ),
      }
    : undefined;
const app = await createApp({
  recoveryChain: bountyServices
    ? new ReadOnlyBountyChain("https://rpc.testnet.arc.io", 5042002, bountyServices.escrow)
    : undefined,
  budgetServices:
    bountyServices && process.env.CIRCLE_AGENT_ADDRESS
      ? {
          chain: new ReadOnlyBudgetChain(
            "https://rpc.testnet.arc.io",
            5042002,
            bountyServices.escrow,
          ),
          network: {
            chainId: 5042002,
            asset: ARC_USDC,
            escrow: bountyServices.escrow,
            operator: address.parse(process.env.CIRCLE_AGENT_ADDRESS),
          },
        }
      : undefined,
  assistantModel:
    process.env.MODEL_API_KEY || process.env.OPENAI_API_KEY ? process.env.MODEL_ID : undefined,
  bountyServices,
  claimServices: bountyServices
    ? {
        config: bountyServices.publicConfig,
        evidence: new FileCiphertextStore(
          process.env.EVIDENCE_DIRECTORY ?? ".local/ciphertext/evidence",
          262192,
        ),
      }
    : undefined,
  pool,
  auth,
  appEnv,
  walletIdentity:
    process.env.PRIVY_APP_ID && process.env.PRIVY_APP_SECRET
      ? new PrivyWalletIdentity(process.env.PRIVY_APP_ID, process.env.PRIVY_APP_SECRET)
      : undefined,
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
});
const close = async () => {
  await app.close();
  await pool.end();
};
process.once("SIGTERM", close);
process.once("SIGINT", close);
await app.listen({
  port: Number(process.env.API_PORT ?? 4187),
  host: appEnv === "local" ? "127.0.0.1" : "0.0.0.0",
});
process.stdout.write(`VulnProof API is ready (${appEnv}).\n`);
