import { createHash } from "node:crypto";
import { type BrowserContext, expect, type Page, type TestInfo } from "@playwright/test";
import type { startBrowserHarness } from "./harness.ts";

type Session = { page: Page; context: BrowserContext; actor: { token: string } };
export async function checkBrowserReceipts(
  h: Awaited<ReturnType<typeof startBrowserHarness>>,
  owner: Session,
  researcher: Session,
  outsider: Session,
  info: TestInfo,
) {
  const checks: string[] = [];
  async function open(session: Session, heading: string) {
    await session.page
      .getByRole("navigation")
      .getByRole("link", { name: "Receipts", exact: true })
      .click();
    await expect(session.page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(
      session.page.getByRole("button", { name: "Export final receipts as CSV" }),
    ).toBeEnabled();
  }
  await open(owner, "Organization receipts");
  const table = owner.page.getByRole("region", { name: "Financial receipts" });
  await expect(table.getByRole("row")).toHaveCount(5);
  await owner.page.getByLabel("From date", { exact: true }).fill("2099-01-02");
  await owner.page.getByLabel("Through date", { exact: true }).fill("2099-01-01");
  await owner.page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect(owner.page.getByRole("alert")).toHaveText(
    "Use an end date on or after the start date.",
  );
  await owner.page.getByLabel("From date", { exact: true }).fill("");
  await owner.page.getByLabel("Through date", { exact: true }).fill("");
  await owner.page.getByLabel("Category").selectOption("PAYMENT");
  await owner.page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table.getByRole("cell", { name: "payment", exact: true })).toBeVisible();
  checks.push("RECEIPT_FILTERS_AND_DATE_VALIDATION");

  async function exported(session: Session, base: string) {
    const created = session.page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().endsWith(`${base}/receipt-exports`),
    );
    await session.page.getByRole("button", { name: "Export final receipts as CSV" }).click();
    const response = await created;
    expect(response.status()).toBe(202);
    const record = (await response.json()) as { id: string; rowCount: number };
    expect(record.rowCount).toBe(1);
    await h.dispatchReceipts();
    const button = session.page.getByRole("button", { name: "Download CSV", exact: true });
    await expect(button).toBeVisible();
    const downloadEvent = session.page.waitForEvent("download");
    await button.click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe(`proofofhack-receipts-${record.id}.csv`);
    const stream = await download.createReadStream(),
      chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    const saved = (
      await h.pool.query(
        "select state,content_hash,snapshot_json from receipt_exports where id=$1",
        [record.id],
      )
    ).rows[0];
    expect(saved.state).toBe("READY");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(saved.content_hash);
    const csv = bytes.toString("utf8");
    expect(csv.trim().split("\r\n")).toHaveLength(2);
    expect(csv).toContain('"PAYMENT","1000000","1"');
    expect(csv).toContain('"Local test chain","31337","FINAL","FIXTURE_ONLY","TRUSTED_SERVICE"');
    expect(csv).toContain(saved.snapshot_json.records[0].transactionHash);
    expect(csv).not.toContain('"FUNDING"');
    bytes.fill(0);
    for (const chunk of chunks) chunk.fill(0);
    return { id: record.id, hash: saved.content_hash };
  }
  const organizationExport = await exported(owner, `/organizations/${h.seed.organizationId}`);
  await open(researcher, "My reward payments");
  await expect(researcher.page.getByLabel("Receipt account")).toHaveValue("researcher");
  const personalExport = await exported(researcher, "/me");
  expect(personalExport.hash).toBe(organizationExport.hash);
  checks.push(
    "RECEIPT_ORGANIZATION_BROWSER_EXPORT",
    "RECEIPT_RESEARCHER_BROWSER_EXPORT",
    "RECEIPT_BROWSER_HASH_AND_EXACT_AMOUNT",
  );
  for (const [session, id] of [
    [outsider, personalExport.id],
    [owner, personalExport.id],
    [researcher, organizationExport.id],
  ] as const) {
    const response = await session.context.request.get(`${h.baseUrl}/api/v1/exports/${id}`, {
      headers: { authorization: `Bearer ${session.actor.token}` },
    });
    expect(response.status()).toBe(404);
  }
  checks.push("RECEIPT_CROSS_ACCOUNT_DOWNLOAD_DENIED");
  const path = `/api/v1/exports/${personalExport.id}`;
  let unexpectedDownload = false;
  const onDownload = () => {
    unexpectedDownload = true;
  };
  researcher.page.on("download", onDownload);
  await researcher.page.route(`**${path}`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: Buffer.concat([await response.body(), Buffer.from(" ")]),
    });
  });
  await researcher.page.getByRole("button", { name: "Download CSV", exact: true }).click();
  await expect(researcher.page.getByRole("alert")).toHaveText(
    "The downloaded file failed its integrity check.",
  );
  expect(unexpectedDownload).toBe(false);
  researcher.page.off("download", onDownload);
  await researcher.page.unroute(`**${path}`);
  checks.push("RECEIPT_CHANGED_CSV_DOWNLOAD_DENIED");
  await owner.page.getByLabel("Receipt account").selectOption("researcher");
  await expect(
    owner.page.getByRole("heading", { level: 1, name: "My reward payments" }),
  ).toBeVisible();
  await expect(
    owner.page.getByText("No receipts match these filters.", { exact: true }),
  ).toBeVisible();
  await expect(owner.page.getByRole("button", { name: "Download CSV", exact: true })).toHaveCount(
    0,
  );
  await owner.page.getByLabel("Receipt account").selectOption("organization");
  await expect(owner.page.getByRole("button", { name: "Download CSV", exact: true })).toBeVisible();
  checks.push("RECEIPT_ACCOUNT_SWITCH_CLEARS_PRIVATE_RECORDS");
  await owner.page.screenshot({ path: info.outputPath("receipts.png"), fullPage: true });
  return checks;
}
