import type { Pool } from "pg";
import { z } from "zod";
import { internalService } from "../../../packages/service-auth/src/http.ts";
import { member } from "../../api/src/context.ts";
import { releaseReport } from "./access.ts";
import { OrganizationKeyStore } from "./keys.ts";
export function createReleaseApp(
  pool: Pool,
  publicKeys: Record<string, string>,
  keyDirectory: string,
) {
  const app = internalService("report-release", publicKeys);
  const keys = new OrganizationKeyStore(keyDirectory);
  app.post("/internal/organization-keys", async (request) => {
    const input = z
      .strictObject({ organizationId: z.uuid(), actorId: z.uuid() })
      .parse(request.body);
    if (request.headers["x-verified-service"] !== "api")
      throw new Error("Only the API can request an organization key.");
    await member(pool, { id: input.actorId, displayName: "" }, input.organizationId, ["OWNER"]);
    return keys.ensure(pool, input.organizationId);
  });
  app.post("/internal/report-releases", async (request) => {
    const input = z.strictObject({ reportId: z.uuid(), eventId: z.uuid() }).parse(request.body);
    if (request.headers["x-verified-service"] !== "worker")
      throw new Error("Only the worker can request report release.");
    const c = await pool.connect();
    try {
      await c.query("begin");
      const report = await releaseReport(c, input.reportId, input.eventId);
      await c.query("commit");
      return { id: report.id, state: report.state };
    } catch (error) {
      await c.query("rollback");
      throw error;
    } finally {
      c.release();
    }
  });
  return app;
}
