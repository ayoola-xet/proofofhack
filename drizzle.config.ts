import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { databaseUrl } from "./packages/database/src/index.ts";

export default defineConfig({ dialect: "postgresql", schema: "./packages/database/src/schema.ts", out: "./packages/database/migrations", dbCredentials: { url: databaseUrl() } });
