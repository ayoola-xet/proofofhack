import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import type { BudgetChain } from "../../../packages/chain/src/budget.ts";
import type { BudgetExecutor } from "../../../packages/circle/src/budget.ts";
import { allocateBudget } from "../../budget/src/allocate.ts";
import { syncController } from "../../budget/src/controllers.ts";
import { enqueueAllocation } from "../../budget/src/enqueue.ts";
import { type CoverageSource, refreshCoverage } from "../../coverage/src/refresh.ts";

export async function sweepBudget(
  pool: Pool,
  chain: BudgetChain,
  source: CoverageSource,
  controllerId: string,
) {
  const { state } = await syncController(pool, chain, controllerId);
  if (!state.enabled) return;
  const controller = (
    await pool.query("select organization_id from budget_controllers where id=$1", [controllerId])
  ).rows[0];
  await refreshCoverage(pool, source, controller.organization_id);
  const c = await pool.connect();
  try {
    await c.query("begin");
    const recommendations = (
      await c.query(
        "select id from recommendations where organization_id=$1 and status='ACTIONABLE' and expires_at>now() and action_json->>'controllerId'=$2 order by created_at desc limit 100",
        [controller.organization_id, controllerId],
      )
    ).rows;
    for (const row of recommendations)
      await enqueueAllocation(c, controller.organization_id, row.id);
    await c.query("commit");
  } catch (error) {
    await c.query("rollback");
    throw error;
  } finally {
    c.release();
  }
}

export async function dispatchBudgetOutbox(boss: PgBoss, pool: Pool) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const rows = (
      await c.query(
        "select * from outbox where event_type='BUDGET_ALLOCATION' and processed_at is null order by created_at limit 50 for update skip locked",
      )
    ).rows;
    for (const row of rows) {
      const data = z.strictObject({ actionId: z.uuid() }).parse(row.payload_json);
      const jobId = await boss.send("budget-allocation", data, {
        id: row.id,
        singletonKey: data.actionId,
        db: { executeSql: (text, values) => c.query(text, values) },
      });
      if (jobId) await c.query("update outbox set processed_at=now() where id=$1", [row.id]);
    }
    await c.query("commit");
  } catch (error) {
    await c.query("rollback");
    throw error;
  } finally {
    c.release();
  }
}

export async function startBudgetJobs(
  boss: PgBoss,
  pool: Pool,
  chain: BudgetChain,
  executor: BudgetExecutor,
  source: CoverageSource,
) {
  await boss.createQueue("budget-allocation", {
    retryLimit: 8,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 240,
    policy: "singleton",
  });
  await boss.work<{ actionId: string }>(
    "budget-allocation",
    { pollingIntervalSeconds: 1 },
    async (jobs) => {
      for (const job of jobs)
        await allocateBudget(pool, chain, executor, source, z.uuid().parse(job.data.actionId));
    },
  );
  await boss.createQueue("budget-controller-refresh", {
    retryLimit: 3,
    retryDelay: 10,
    expireInSeconds: 240,
    policy: "singleton",
  });
  await boss.work<{ controllerId: string }>("budget-controller-refresh", async (jobs) => {
    for (const job of jobs)
      await sweepBudget(pool, chain, source, z.uuid().parse(job.data.controllerId));
  });
  await boss.createQueue("budget-sweep", {
    retryLimit: 3,
    expireInSeconds: 60,
    policy: "singleton",
  });
  await boss.work("budget-sweep", async () => {
    let after: string | null = null;
    while (true) {
      const rows: { id: string }[] = (
        await pool.query(
          "select id from budget_controllers where ($1::uuid is null or id>$1) order by id limit 100",
          [after],
        )
      ).rows;
      for (const row of rows)
        await boss.send(
          "budget-controller-refresh",
          { controllerId: row.id },
          { singletonKey: row.id },
        );
      if (rows.length < 100) break;
      after = rows[rows.length - 1].id;
    }
  });
  await boss.createQueue("budget-dispatch", {
    retryLimit: 5,
    expireInSeconds: 60,
    policy: "singleton",
  });
  await boss.work("budget-dispatch", { pollingIntervalSeconds: 1 }, async () =>
    dispatchBudgetOutbox(boss, pool),
  );
  await boss.schedule("budget-sweep", "* * * * *");
  await boss.schedule("budget-dispatch", "* * * * *");
  await boss.send("budget-sweep");
  await boss.send("budget-dispatch");
}
