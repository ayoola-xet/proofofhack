import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "../packages/database/src/index.ts";

const { db, pool } = connectDatabase();
try {
  await migrate(db, { migrationsFolder: "packages/database/migrations" });
  console.log("Database migrations applied.");
} finally {
  await pool.end();
}
