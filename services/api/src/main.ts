import "dotenv/config";
import { readFile } from "node:fs/promises";
import { createRemoteJWKSet } from "jose";
import { z } from "zod";
import { connectDatabase } from "../../../packages/database/src/index.ts";
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
const app = await createApp({
  pool,
  auth,
  appEnv,
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
