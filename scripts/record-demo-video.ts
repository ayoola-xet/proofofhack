import { mkdir, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type BrowserContext, chromium, type Page } from "@playwright/test";
import { startBrowserHarness } from "../tests/e2e/harness.ts";

const VIEWPORT = { width: 1920, height: 1080 };

async function waitFor(
  check: () => Promise<boolean> | boolean,
  { timeoutMs = 30000, intervalMs = 250 } = {},
) {
  const start = Date.now();
  for (;;) {
    if (await check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for a condition.");
    await new Promise((done) => setTimeout(done, intervalMs));
  }
}

async function main() {
  console.log("Starting ProofOfHack demo video recording harness...");
  const harness = await startBrowserHarness();
  try {
    await record(harness);
  } finally {
    await harness.stop();
  }
}

async function record(harness: Awaited<ReturnType<typeof startBrowserHarness>>) {
  const outputDir = resolve("output/demo-video/raw");
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true, channel: "chromium" });

  function actorFor(role: string) {
    const actor = harness.actors.find((row) => row.role === role);
    const wallet = harness.seed.wallets.find((row) => row.role === role);
    if (!actor || !wallet) throw new Error(`Missing local actor for role ${role}.`);
    return { actor, wallet };
  }

  async function openScene(role: string | null) {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      recordVideo: { dir: outputDir, size: VIEWPORT },
      serviceWorkers: "block",
    });
    if (role) {
      const { actor, wallet } = actorFor(role);
      await context.addInitScript(
        (identity) => {
          window.__PROOFOFHACK_E2E_IDENTITY__ = identity;
        },
        {
          token: actor.token,
          subject: actor.subject,
          address: wallet.address,
          displayName: actor.displayName,
        },
      );
    }
    // The local Privy test shim renders a "LOCAL BROWSER TEST" banner (role="note").
    // It's not used anywhere else in the app, so hiding it here is safe and keeps the
    // demo footage free of test-harness scaffolding without touching the shared test shim.
    await context.addInitScript(() => {
      const style = document.createElement("style");
      style.textContent = 'div[role="note"]{display:none!important}';
      document.head
        ? document.head.append(style)
        : document.addEventListener("DOMContentLoaded", () => document.head.append(style));
    });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === harness.baseUrl) await route.continue();
      else if (route.request().url().startsWith("https://fonts.googleapis.com/"))
        await route.fulfill({ status: 200, contentType: "text/css", body: "" });
      else await route.abort();
    });
    const page = await context.newPage();
    return { context, page };
  }

  async function closeScene(context: BrowserContext, page: Page, filename: string) {
    const videoPath = await page.video()?.path();
    await page.close();
    await context.close();
    if (videoPath) await rename(videoPath, join(outputDir, filename));
  }

  async function login(page: Page) {
    const enter = page.getByRole("button", { name: "Open your workspace" });
    await enter.click();
    await page.getByRole("navigation", { name: "Main navigation" }).waitFor();
  }

  async function goTo(page: Page, label: string) {
    await page.getByRole("navigation").getByRole("link", { name: label, exact: true }).click();
  }

  async function smoothScroll(page: Page, top: number) {
    await page.evaluate((amount) => window.scrollBy({ top: amount, behavior: "smooth" }), top);
  }

  // Scene 1: Landing page, unauthenticated value proposition.
  // The local Privy shim always requires an injected identity, even before login,
  // so we inject one here but simply never click "Open your workspace".
  {
    const { context, page } = await openScene("RESEARCHER");
    await page.goto(`${harness.baseUrl}/`);
    await page.waitForTimeout(4000);
    await smoothScroll(page, 380);
    await page.waitForTimeout(4500);
    await smoothScroll(page, 420);
    await page.waitForTimeout(6500);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await page.waitForTimeout(4000);
    await closeScene(context, page, "01-landing.webm");
  }

  // Scene 2: Protocol team - overview, vault coverage (The Graph), and bounty review (Arc escrow).
  {
    const { context, page } = await openScene("OWNER");
    await page.goto(`${harness.baseUrl}/`);
    await login(page);
    await page.waitForTimeout(3200);
    await smoothScroll(page, 480);
    await page.waitForTimeout(5000);
    await goTo(page, "Vault coverage");
    await page.waitForTimeout(4200);
    await smoothScroll(page, 260);
    await page.waitForTimeout(5000);
    await goTo(page, "Fixture bounties");
    await page.waitForTimeout(2600);
    const rewardInput = page.getByLabel("Reward (test USDC)");
    if (await rewardInput.isVisible().catch(() => false)) {
      console.log("Scene 2: bounty-creation form is interactive, filling reward field.");
      await rewardInput.fill("2.5");
      await page.waitForTimeout(2200);
      await page.getByLabel("Source vault").click();
      await page.waitForTimeout(1200);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1600);
    } else {
      console.log("Scene 2: bounty-creation reward field was not visible.");
    }
    await smoothScroll(page, 700);
    await page.waitForTimeout(3800);
    await page.getByRole("article").first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(5200);
    await closeScene(context, page, "02-protocol.webm");
  }

  // Scene 3: Researcher discovers the bounty and submits an encrypted claim.
  // The /bounties page lists every funded bounty system-wide ordered by bounty_id,
  // so the visible card index must account for the seeded findings-program bounty too.
  const allBountyIds = [
    ...harness.seed.bounties.map((row) => row.bountyId),
    harness.seed.findingsProgram.bountyId,
  ].sort((a, b) => a.localeCompare(b));
  const orderedBounties = [...harness.seed.bounties].sort((a, b) =>
    a.bountyId.localeCompare(b.bountyId),
  );
  const qualifyingBountyId = orderedBounties.find((row) => row.label === "QUALIFYING")?.bountyId;
  if (!qualifyingBountyId) throw new Error("The local qualifying fixture bounty is missing.");
  const qualifyingIndex = allBountyIds.indexOf(qualifyingBountyId);
  const qualifyingFixture = harness.fixtures.fixtures.find((row) => row.label === "QUALIFYING");
  if (qualifyingIndex < 0 || !qualifyingFixture)
    throw new Error("The local qualifying fixture is missing.");
  let claimId = "";
  {
    const { context, page } = await openScene("RESEARCHER");
    await page.goto(`${harness.baseUrl}/bounties`);
    await login(page);
    await page.getByRole("article").first().waitFor();
    await page.waitForTimeout(4200);
    const card = page.getByRole("article").nth(qualifyingIndex);
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2400);
    await card.getByLabel("Signed case file").setInputFiles({
      name: "QUALIFYING.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(qualifyingFixture.fixture)),
    });
    await page.waitForTimeout(3000);
    const prepared = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().includes("/uploads"),
    );
    const uploaded = page.waitForResponse(
      (response) => response.request().method() === "PUT" && response.url().endsWith("/ciphertext"),
    );
    await card.getByRole("button", { name: "Submit encrypted case", exact: true }).click();
    const preparedResponse = await prepared;
    ({ claimId } = (await preparedResponse.json()) as { claimId: string });
    await uploaded;
    await page.waitForTimeout(5000);
    await closeScene(context, page, "03-researcher-submit.webm");
  }

  // Off camera: settle the claim exactly as the real worker pipeline would.
  console.log(`Dispatching verification for claim ${claimId}...`);
  await harness.dispatch();
  console.log("Waiting for the relayer to reach the payment step...");
  await waitFor(() => harness.paymentStopped(), { timeoutMs: 60000 });
  console.log("Releasing the guaranteed payout...");
  harness.allowPayment();
  console.log("Waiting for the report to unlock...");
  await waitFor(
    async () =>
      (await harness.pool.query("select state from reports where claim_id=$1", [claimId])).rows[0]
        ?.state === "AVAILABLE",
    { timeoutMs: 60000 },
  );
  await waitFor(
    async () =>
      (await harness.pool.query("select count(*)::int n from receipts where category='PAYMENT'"))
        .rows[0].n > 0,
    { timeoutMs: 15000 },
  );
  console.log("Payout settled. Recording the payoff scenes...");

  // Scene 4: Researcher gets paid - claim outcome, sealed report, and the payment receipt.
  {
    const { context, page } = await openScene("RESEARCHER");
    await page.goto(`${harness.baseUrl}/reports`);
    await login(page);
    await page.waitForTimeout(4600);
    await smoothScroll(page, 220);
    await page.waitForTimeout(4800);
    await goTo(page, "Receipts");
    await page.waitForTimeout(6000);
    await closeScene(context, page, "04-payout.webm");
  }

  // Scene 5: Protocol team unlocks the private report only after payment is final.
  {
    const { context, page } = await openScene("OWNER");
    await page.goto(`${harness.baseUrl}/reports`);
    await login(page);
    await page.waitForTimeout(4600);
    await smoothScroll(page, 220);
    await page.waitForTimeout(4600);
    await goTo(page, "Overview");
    await page.waitForTimeout(5000);
    await closeScene(context, page, "05-protocol-unlock.webm");
  }

  await browser.close();
  console.log(`\nRaw scene footage saved to: ${outputDir}`);
}

main().catch((err) => {
  console.error("Recording error:", err);
  process.exit(1);
});
