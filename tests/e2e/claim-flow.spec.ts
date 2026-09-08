import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { erc20Abi, keccak256 } from "viem";
import { startBrowserHarness } from "./harness.ts";

test("Encrypted claim, final payment, report integrity, and current access at the browser", async ({
  browser,
  viewport,
  reducedMotion,
}, info) => {
  const contexts: BrowserContext[] = [],
    checks: string[] = [];
  let harness: Awaited<ReturnType<typeof startBrowserHarness>> | undefined;
  let result = "FAIL",
    cleaned = false;
  const startedAt = new Date().toISOString();
  const sourceFiles = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "apps",
      "packages",
      "services",
      "contracts",
      "tests",
      "scripts",
      "infra",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "playwright.config.ts",
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  const sourceHashes = Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (path) => [
        path,
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      ]),
    ),
  );
  try {
    harness = await startBrowserHarness();
    const h = harness;
    const markers = h.fixtures.fixtures.flatMap(({ fixture }) => [
      String(fixture.caseId),
      String(fixture.salt),
    ]);
    const exposedMarkers: string[] = [],
      browserErrors: string[] = [];
    let ciphertextUploads = 0;
    async function session(role: string, route: string) {
      const actor = h.actors.find((row) => row.role === role);
      const wallet = h.seed.wallets.find((row) => row.role === role);
      if (!actor || !wallet) throw new Error("A local browser actor is missing.");
      const context = await browser.newContext({
        viewport,
        reducedMotion,
        serviceWorkers: "block",
      });
      contexts.push(context);
      await context.addInitScript(
        (identity) => {
          window.__VULNPROOF_E2E_IDENTITY__ = identity;
        },
        {
          token: actor.token,
          subject: actor.subject,
          address: wallet.address,
          displayName: actor.displayName,
        },
      );
      await context.route("**/*", async (request) => {
        if (new URL(request.request().url()).origin === h.baseUrl) await request.continue();
        else if (request.request().url().startsWith("https://fonts.googleapis.com/"))
          await request.fulfill({ status: 200, contentType: "text/css", body: "" });
        else await request.abort();
      });
      const page = await context.newPage();
      page.on("pageerror", () => browserErrors.push("PAGE_ERROR"));
      page.on("request", (request) => {
        if (!request.url().includes("/api/v1/")) return;
        const body = request.postDataBuffer();
        if (!body) return;
        if (
          request.method() === "PUT" &&
          request.headers()["content-type"] === "application/octet-stream"
        )
          ciphertextUploads++;
        for (const marker of markers)
          if (body.includes(Buffer.from(marker))) exposedMarkers.push("PRIVATE_FIXTURE_MARKER");
      });
      await page.goto(`${h.baseUrl}${route}`);
      await expect(page.getByRole("note")).toContainText("LOCAL BROWSER TEST");
      const enter = page.getByRole("button", { name: "Open your workspace" });
      await expect(enter).toBeEnabled();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await expect(enter).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
      return { page, context, actor, wallet };
    }
    const researcher = await session("RESEARCHER", "/bounties");
    await expect(researcher.page.getByRole("article")).toHaveCount(3);
    checks.push("KEYBOARD_SIGN_IN");
    const orderedBounties = [...h.seed.bounties].sort((a, b) =>
      a.bountyId.localeCompare(b.bountyId),
    );
    async function submit(label: string) {
      await researcher.page
        .getByRole("navigation")
        .getByRole("link", { name: "Fixture bounties", exact: true })
        .click();
      await expect(researcher.page.getByRole("article")).toHaveCount(3);
      const index = orderedBounties.findIndex((item) => item.label === label);
      const fixture = h.fixtures.fixtures.find((item) => item.label === label);
      if (index < 0 || !fixture) throw new Error("The selected synthetic case is missing.");
      const card = researcher.page.getByRole("article").nth(index);
      await card.getByLabel("Signed case file").setInputFiles({
        name: `${label}.json`,
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(fixture.fixture)),
      });
      await expect(card.getByLabel("Reward wallet")).toHaveValue(researcher.wallet.walletId);
      const prepared = researcher.page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith(`/bounties/${orderedBounties[index].bountyId}/uploads`),
      );
      const uploaded = researcher.page.waitForResponse(
        (response) =>
          response.request().method() === "PUT" && response.url().endsWith("/ciphertext"),
      );
      await card.getByRole("button", { name: "Submit encrypted case", exact: true }).click();
      const preparedResponse = await prepared;
      expect(preparedResponse.status()).toBe(201);
      const record = (await preparedResponse.json()) as { claimId: string; uploadId: string };
      expect((await uploaded).status()).toBe(200);
      await h.dispatch();
      return record;
    }
    const qualified = await submit("QUALIFYING");
    await expect.poll(h.paymentStopped).toBe(true);
    const report = (
      await h.pool.query("select id,report_hash,state from reports where claim_id=$1", [
        qualified.claimId,
      ])
    ).rows[0];
    expect(report.state).toBe("SEALED");
    const owner = await session("OWNER", "/reports");
    const reviewer = await session("REVIEWER", "/reports");
    const outsider = await session("OUTSIDER", "/reports");
    const headers = (token: string) => ({ authorization: `Bearer ${token}` });
    const reportPath = `/private/organization/reports/${report.id}`;
    expect(
      (
        await owner.context.request.get(`${h.baseUrl}${reportPath}`, {
          headers: headers(owner.actor.token),
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await outsider.context.request.get(`${h.baseUrl}${reportPath}`, {
          headers: headers(outsider.actor.token),
        })
      ).status(),
    ).toBe(404);
    await expect(owner.page.getByText("SEALED", { exact: true })).toBeVisible();
    await expect(owner.page.getByRole("button", { name: "Download report" })).toHaveCount(0);
    checks.push(
      "PRI-01_CIPHERTEXT_UPLOAD",
      "PRI-03_ORGANIZATION_LOCKED_BEFORE_PAYMENT",
      "AUTH-02_OUTSIDER_REPORT_HIDDEN",
    );
    const balanceBefore = await h.client.readContract({
      address: h.seed.asset,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [researcher.wallet.address as `0x${string}`],
    });
    h.allowPayment();
    await expect
      .poll(
        async () =>
          (await h.pool.query("select state from reports where id=$1", [report.id])).rows[0].state,
      )
      .toBe("AVAILABLE");
    const balanceAfter = await h.client.readContract({
      address: h.seed.asset,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [researcher.wallet.address as `0x${string}`],
    });
    expect(balanceAfter - balanceBefore).toBe(1000000n);
    expect(
      (
        await h.pool.query(
          "select count(*)::int n from chain_events where name='Paid' and payload_json->>'claimId'=$1 and finality_state='FINAL'",
          [qualified.claimId],
        )
      ).rows[0].n,
    ).toBe(1);
    checks.push("VER-01_QUALIFYING_BROWSER_FLOW", "ESC-08_EXACT_REWARD_ONCE");
    async function reportDownload(page: Page) {
      const event = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download report", exact: true }).click();
      const stream = await (await event).createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      expect(keccak256(bytes)).toBe(report.report_hash);
      return bytes;
    }
    await owner.page.reload();
    await expect(owner.page.getByText("AVAILABLE", { exact: true })).toBeVisible();
    const organizationBytes = await reportDownload(owner.page);
    await researcher.page
      .getByRole("navigation")
      .getByRole("link", { name: "Private reports", exact: true })
      .click();
    await expect(researcher.page.getByText("Qualifying case", { exact: true })).toBeVisible();
    const researcherBytes = await reportDownload(researcher.page);
    expect(researcherBytes.equals(organizationBytes)).toBe(true);
    organizationBytes.fill(0);
    researcherBytes.fill(0);
    checks.push("PRI-04_PAID_REPORT_HASH_MATCHES");
    let unexpectedDownload = false;
    const onDownload = () => {
      unexpectedDownload = true;
    };
    owner.page.on("download", onDownload);
    await owner.page.route(`**${reportPath}`, async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: Buffer.concat([await response.body(), Buffer.from(" ")]),
      });
    });
    await owner.page.getByRole("button", { name: "Download report", exact: true }).click();
    await expect(owner.page.getByRole("alert")).toContainText("does not match its saved hash");
    expect(unexpectedDownload).toBe(false);
    owner.page.off("download", onDownload);
    await owner.page.unroute(`**${reportPath}`);
    checks.push("PRI-05_BROWSER_REJECTS_CHANGED_REPORT");
    await reviewer.page.reload();
    await expect(
      reviewer.page.getByRole("button", { name: "Download report", exact: true }),
    ).toBeVisible();
    const revoked = await owner.context.request.patch(
      `${h.baseUrl}/api/v1/organizations/${h.seed.organizationId}/members/${reviewer.wallet.userId}`,
      {
        headers: {
          ...headers(owner.actor.token),
          "idempotency-key": randomUUID(),
          "if-match": "1",
        },
        data: { status: "DISABLED" },
      },
    );
    expect(revoked.status()).toBe(200);
    await reviewer.page.getByRole("button", { name: "Download report", exact: true }).click();
    await expect(reviewer.page.getByRole("alert")).toContainText("not available");
    checks.push("AUTH-03_OPEN_BROWSER_REVOCATION");
    for (const label of ["ZERO_CONTROL", "BELOW_THRESHOLD"]) {
      const control = await submit(label);
      await expect
        .poll(
          async () =>
            (
              await h.pool.query("select job_state from claims where claim_id=$1", [
                control.claimId,
              ])
            ).rows[0].job_state,
        )
        .toBe("SETTLED");
      const record = (
        await h.pool.query(
          "select r.id,r.state,a.outcome from reports r join assessments a on a.claim_id=r.claim_id where r.claim_id=$1",
          [control.claimId],
        )
      ).rows[0];
      expect(record).toMatchObject({ state: "SEALED", outcome: "DOES_NOT_QUALIFY" });
      expect(
        (
          await owner.context.request.get(
            `${h.baseUrl}/private/organization/reports/${record.id}`,
            { headers: headers(owner.actor.token) },
          )
        ).status(),
      ).toBe(409);
      expect(
        (
          await h.pool.query(
            "select count(*)::int n from chain_events where name='Paid' and payload_json->>'claimId'=$1",
            [control.claimId],
          )
        ).rows[0].n,
      ).toBe(0);
      checks.push(
        label === "ZERO_CONTROL"
          ? "VER-02_ZERO_CONTROL_NO_PAYMENT"
          : "VER-03_BELOW_THRESHOLD_NO_PAYMENT",
      );
    }
    for (const page of [owner.page, researcher.page, reviewer.page]) {
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      expect(
        await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches),
      ).toBe(reducedMotion === "reduce");
      if (reducedMotion === "reduce") {
        const animation = await page.evaluate(() => {
          const probe = document.createElement("span");
          probe.className = "spin";
          document.body.append(probe);
          const name = getComputedStyle(probe).animationName;
          probe.remove();
          return name;
        });
        expect(animation).toBe("none");
      }
    }
    expect(ciphertextUploads).toBe(3);
    expect(exposedMarkers).toEqual([]);
    expect(browserErrors).toEqual([]);
    expect(h.blockedServerRequests).toEqual([]);
    expect(h.queueErrors).toEqual([]);
    checks.push(
      "BROWSER_REQUESTS_HAVE_NO_PRIVATE_FIXTURE_MARKERS",
      "CLAIM_REPORT_LAYOUT_WITHIN_VIEWPORT",
      "NO_EXTERNAL_SERVER_REQUESTS",
    );
    await researcher.page.screenshot({ path: info.outputPath("claim-flow.png"), fullPage: true });
    result = "PASS";
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    if (harness) {
      await harness.stop();
      cleaned = true;
    }
    await mkdir("evidence/local", { recursive: true });
    await writeFile(
      `evidence/local/browser-e2e-${info.project.name}.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          scope: "LOCAL_BROWSER_FIXTURE_FLOW",
          result,
          cleaned,
          environment: "local",
          chainId: 31337,
          liveSponsorEvidence: false,
          viewport,
          reducedMotion,
          startedAt,
          finishedAt: new Date().toISOString(),
          sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
          sourceHashes,
          browserVersion: browser.version(),
          checks,
          limits: [
            "Login and relaying use local provider substitutes.",
            "This is the fixture claim and report flow. It does not cover every product journey.",
            "This is not a hosted recovery, live sponsor, model, or performance test.",
          ],
        },
        null,
        2,
      )}\n`,
    );
  }
});
