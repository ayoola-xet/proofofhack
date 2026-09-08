import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";

export function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (!process.env.APP_ENV || process.env.APP_ENV === "local")
    return "postgres://vulnproof:vulnproof_local@127.0.0.1:5433/vulnproof";
  throw new Error("DATABASE_URL is required outside the local environment.");
}
export function connectDatabase(url = databaseUrl()) {
  const pool = new pg.Pool({
    connectionString: url,
    max: 15,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
export type Database = ReturnType<typeof connectDatabase>["db"];
export { schema };
