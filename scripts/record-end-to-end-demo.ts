import { mkdir, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "@playwright/test";
import { startBrowserHarness } from "../tests/e2e/harness.ts";

async function main() {
  console.log("Starting full end-to-end demo video recording harness...");
  const harness = await startBrowserHarness();
  const outputDir = resolve("output/demo-video");
  await mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    channel: "chromium",
  });

  const ownerActor = harness.actors.find((row) => row.role === "OWNER") ?? harness.actors[0];
  const ownerWallet = harness.seed.wallets.find((row) => row.role === "OWNER") ?? harness.seed.wallets[0];

  const researcherActor = harness.actors.find((row) => row.role === "RESEARCHER") ?? harness.actors[3];
  const researcherWallet = harness.seed.wallets.find((row) => row.role === "RESEARCHER") ?? harness.seed.wallets[3];

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: outputDir, size: { width: 1920, height: 1080 } },
    serviceWorkers: "block",
  });

  // Inject initial owner identity script before page load
  await context.addInitScript(
    (identity) => {
      // @ts-ignore
      window.__PROOFOFHACK_E2E_IDENTITY__ = identity;
    },
    {
      token: ownerActor.token,
      subject: ownerActor.subject,
      address: ownerWallet.address,
      displayName: ownerActor.displayName,
    },
  );

  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === harness.baseUrl) await route.continue();
    else if (route.request().url().startsWith("https://fonts.googleapis.com/"))
      await route.fulfill({ status: 200, contentType: "text/css", body: "" });
    else await route.abort();
  });

  const page = await context.newPage();

  console.log("==========================================");
  console.log("SCENE 1: Public Landing Page & Product Overview");
  console.log("==========================================");
  await page.goto(`${harness.baseUrl}/`);
  await page.waitForTimeout(3000);

  // Smooth scroll down to feature cards
  await page.evaluate(() => window.scrollBy({ top: 400, behavior: "smooth" }));
  await page.waitForTimeout(3500);

  await page.evaluate(() => window.scrollBy({ top: 400, behavior: "smooth" }));
  await page.waitForTimeout(4000);

  // Scroll back to top
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await page.waitForTimeout(2500);

  console.log("==========================================");
  console.log("SCENE 2: Protocol Owner — Organization & Restricted Treasury Setup");
  console.log("==========================================");
  const enterBtn = page.getByRole("button", { name: "Open your workspace" });
  await enterBtn.click();
  await page.waitForTimeout(3500);

  // Navigate to Organization page
  await page.getByRole("navigation").getByRole("link", { name: "Organization", exact: true }).click();
  await page.waitForTimeout(3500);

  // Scroll down to view funding wallet details
  await page.evaluate(() => window.scrollBy({ top: 300, behavior: "smooth" }));
  await page.waitForTimeout(3500);

  console.log("==========================================");
  console.log("SCENE 3: Protocol Owner — Vault Coverage & The Graph Subgraphs");
  console.log("==========================================");
  await page.getByRole("navigation").getByRole("link", { name: "Vault coverage", exact: true }).click();
  await page.waitForTimeout(3500);

  // Scroll vault table & AI Assistant section
  await page.evaluate(() => window.scrollBy({ top: 350, behavior: "smooth" }));
  await page.waitForTimeout(4000);

  console.log("==========================================");
  console.log("SCENE 4: Protocol Owner — Inspecting Active Bounties on Arc Testnet");
  console.log("==========================================");
  await page.getByRole("navigation").getByRole("link", { name: "Fixture bounties", exact: true }).click();
  await page.waitForTimeout(4000);

  console.log("==========================================");
  console.log("SCENE 5: Security Researcher — Submitting Encrypted Claim & Reservation");
  console.log("==========================================");
  // Switch in-page identity to Security Researcher
  await page.evaluate(
    (identity) => {
      // @ts-ignore
      window.__PROOFOFHACK_E2E_IDENTITY__ = identity;
    },
    {
      token: researcherActor.token,
      subject: researcherActor.subject,
      address: researcherWallet.address,
      displayName: researcherActor.displayName,
    },
  );
  await page.reload();
  await page.waitForTimeout(3000);

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
      await page.waitForTimeout(2000);

      const submitBtn = card.getByRole("button", { name: "Submit encrypted case", exact: true });
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        await page.waitForTimeout(3500);

        console.log("==========================================");
        console.log("SCENE 6: Isolated Verifier & Automated USDC Payout");
        console.log("==========================================");
        // Process worker jobs to verify proof & allow payment collection on Anvil
        await harness.dispatch();
        harness.allowPayment();
        await page.waitForTimeout(4500);
      }
    }
  }

  console.log("==========================================");
  console.log("SCENE 7: Protocol Owner — Post-Payment Private Report Release & Receipts");
  console.log("==========================================");
  // Switch session back to Protocol Owner to show report unlock
  await page.evaluate(
    (identity) => {
      // @ts-ignore
      window.__PROOFOFHACK_E2E_IDENTITY__ = identity;
    },
    {
      token: ownerActor.token,
      subject: ownerActor.subject,
      address: ownerWallet.address,
      displayName: ownerActor.displayName,
    },
  );
  await page.reload();
  await page.waitForTimeout(2000);

  await page.getByRole("navigation").getByRole("link", { name: "Private reports", exact: true }).click();
  await page.waitForTimeout(4000);

  const downloadBtn = page.getByRole("button", { name: "Download report" }).first();
  if (await downloadBtn.isVisible()) {
    await downloadBtn.click();
    await page.waitForTimeout(3500);
  }

  // View Financial Receipts
  await page.getByRole("navigation").getByRole("link", { name: "Receipts", exact: true }).click();
  await page.waitForTimeout(4000);

  // Return to Overview
  await page.getByRole("navigation").getByRole("link", { name: "Overview", exact: true }).click();
  await page.waitForTimeout(4500);

  // Close page and context to complete video file output
  const videoPath = await page.video()?.path();
  await page.close();
  await context.close();
  await browser.close();
  await harness.stop();

  if (videoPath) {
    const targetFile = join(outputDir, "proofofhack-end-to-end.webm");
    await rename(videoPath, targetFile);
    console.log(`\n🎉 SUCCESS! End-to-end demo video recorded to: ${targetFile}`);
  } else {
    console.log(`\n🎉 End-to-end demo video saved in output/demo-video/`);
  }
}

main().catch((err) => {
  console.error("Recording error:", err);
  process.exit(1);
});
