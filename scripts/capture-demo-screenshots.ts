import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "@playwright/test";
import { startBrowserHarness } from "../tests/e2e/harness.ts";

async function main() {
  console.log("Starting screenshot capture harness (with Programs page)...");
  const harness = await startBrowserHarness();
  const artifactDir = "/Users/Apple/.gemini/antigravity-cli/brain/f5bf71a9-ea4b-4824-b231-eed16060f5dc/screenshots";
  await mkdir(artifactDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    channel: "chromium",
  });

  const actor = harness.actors.find((row) => row.role === "RESEARCHER") ?? harness.actors[0];
  const wallet = harness.seed.wallets.find((row) => row.role === "RESEARCHER") ?? harness.seed.wallets[0];

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    serviceWorkers: "block",
  });

  await context.addInitScript(
    (identity) => {
      // @ts-ignore
      window.__PROOFOFHACK_E2E_IDENTITY__ = identity;
    },
    {
      token: actor.token,
      subject: actor.subject,
      address: wallet.address,
      displayName: actor.displayName,
    },
  );

  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === harness.baseUrl) await route.continue();
    else if (route.request().url().startsWith("https://fonts.googleapis.com/"))
      await route.fulfill({ status: 200, contentType: "text/css", body: "" });
    else await route.abort();
  });

  const page = await context.newPage();

  // 1. Landing Page
  console.log("Capturing 01-landing-page.png...");
  await page.goto(`${harness.baseUrl}/`);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(artifactDir, "01-landing-page.png"), fullPage: false });

  // Sign in
  const enter = page.getByRole("button", { name: "Open your workspace" });
  await enter.click();
  await page.waitForTimeout(2000);

  // 2. Programs Directory Page
  console.log("Capturing 07-programs-directory.png...");
  await page.getByRole("navigation").getByRole("link", { name: "Programs", exact: true }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(artifactDir, "07-programs-directory.png"), fullPage: false });

  // 3. Organization Workspace & Treasury
  console.log("Capturing 02-organization-workspace.png...");
  await page.getByRole("navigation").getByRole("link", { name: "Organization", exact: true }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(artifactDir, "02-organization-workspace.png"), fullPage: false });

  // 4. Vault Coverage (The Graph Subgraphs)
  console.log("Capturing 03-vault-coverage.png...");
  await page.getByRole("navigation").getByRole("link", { name: "Vault coverage", exact: true }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(artifactDir, "03-vault-coverage.png"), fullPage: false });

  // 5. AI Coverage Assistant
  console.log("Capturing 04-ai-coverage-assistant.png...");
  const assistantButton = page.getByRole("button", { name: /Ask coverage assistant|Coverage assistant/i });
  if (await assistantButton.isVisible()) {
    await assistantButton.click();
    await page.waitForTimeout(1000);
    const textarea = page.getByPlaceholder(/Ask about registered vaults|Ask coverage/i);
    if (await textarea.isVisible()) {
      await textarea.type("Which registered vaults currently lack funded bounty coverage?", { delay: 20 });
      const submitQuery = page.getByRole("button", { name: /Ask|Submit/i });
      if (await submitQuery.isVisible()) {
        await submitQuery.click();
        await page.waitForTimeout(4000);
      }
    }
  }
  await page.screenshot({ path: join(artifactDir, "04-ai-coverage-assistant.png"), fullPage: false });

  // 6. Fixture Bounties & Arc Escrow
  console.log("Capturing 05-bounties-escrow.png...");
  await page.getByRole("navigation").getByRole("link", { name: "Fixture bounties", exact: true }).click();
  await page.waitForTimeout(2500);

  const qualifyingFixture = harness.fixtures.fixtures.find((item) => item.label === "QUALIFYING");
  if (qualifyingFixture) {
    const card = page.getByRole("article").first();
    const fileInput = card.getByLabel("Signed case file");
    if (await fileInput.isVisible()) {
      await fileInput.setInputFiles({
        name: "QUALIFYING.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(qualifyingFixture.fixture)),
      });
      const submitBtn = card.getByRole("button", { name: "Submit encrypted case", exact: true });
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        await page.waitForTimeout(2000);
        await harness.dispatch();
        harness.allowPayment();
        await page.waitForTimeout(3000);
      }
    }
  }
  await page.screenshot({ path: join(artifactDir, "05-bounties-escrow.png"), fullPage: false });

  // 7. Private Security Report & Receipts
  console.log("Capturing 06-private-report-receipts.png...");
  await page.getByRole("navigation").getByRole("link", { name: "Private reports", exact: true }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(artifactDir, "06-private-report-receipts.png"), fullPage: false });

  await browser.close();
  await harness.stop();
  console.log("🎉 All 7 screenshots captured successfully in:", artifactDir);
}

main().catch((err) => {
  console.error("Screenshot capture error:", err);
  process.exit(1);
});
