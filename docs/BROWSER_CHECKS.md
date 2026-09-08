# Browser checks

`pnpm test:e2e` runs the fixture claim and report flow in Chromium. It uses the real web application, API, PostgreSQL, durable claim queue, verifier, report services, and local escrow contract. It uses local substitutes for Privy login and transaction relaying.

## Run the check

1. Use the Node, pnpm, and Foundry versions in [Development checks](DEVELOPMENT_CHECKS.md).
2. Start the local PostgreSQL service. Its user needs permission to create test databases.
3. Install Chromium with `pnpm exec playwright install --no-shell chromium`.
4. Run `pnpm test:e2e`.

On Linux, use `pnpm exec playwright install --with-deps --no-shell chromium` to install the browser and its system dependencies. The configuration uses Chromium's full browser executable in headless mode.

To use an existing Chromium browser, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its absolute executable path. The saved result records the browser version.

The command first builds the contracts. It then runs the flow twice: once at 1440 by 1000 pixels, and once at 390 by 844 pixels with reduced motion. Use `pnpm test:e2e --project=desktop` to run one project while you fix a failure.

## Test isolation

Each run creates a new local seed database and starts its own Anvil process. It uses free loopback ports. It does not use the active Arc demo database, provider credentials, or browser profile. Anvil uses `--prune-history 4096` to limit temporary state storage.

The test frontend does not read `.env`. Its private Vite configuration replaces only the Privy browser module. The substitute requires a local seed identity and a local development origin. The normal frontend configuration has no substitute or local sign-in fallback. Live wallet confirmation functions fail if this test tries to call them.

Every test page shows a local-test banner. The production UI still contains its Arc Testnet labels. The banner states that this run uses local chain `31337` and no live sponsor account. The browser blocks external requests. It uses a fallback font. The server also blocks external HTTP requests and checks that none were attempted.

The verifier and report services listen on separate local ports. Internal requests use the actual service identity tokens. The test uses the production durable claim queue. It advances local block finality and controls the local payment pause. This is a local functional check, not a container isolation or hosted recovery test.

## Checked behavior

- Open the app with keyboard navigation.
- Submit three fixture cases through the browser forms.
- Check that the API receives ciphertext and no private fixture markers.
- Pause the qualifying claim before payment. Confirm that organization report access is locked.
- Confirm that an outsider receives 404 for the private report.
- Continue payment. Confirm one exact reward and one final Paid event.
- Download the report through the organization and researcher browser paths. Compare both files with the saved report hash.
- Change the report response bytes. Confirm that the browser refuses to save the changed file.
- Remove a reviewer while their browser remains open. Confirm that the next download fails.
- Settle both control cases. Confirm no payment and no organization report access.
- Check viewport width and the reduced-motion preference. Confirm that loading animation is disabled in reduced-motion mode.

## Evidence and cleanup

The command writes one sanitized result per browser project:

- `evidence/local/browser-e2e-desktop.json`
- `evidence/local/browser-e2e-mobile-reduced-motion.json`

Each result records the local scope, viewport, browser version, source commit, source file hashes, and completed checks. A source commit can precede uncommitted test changes. Use the file hashes to identify the exact tested sources. A passing local result does not become live sponsor evidence.

Screenshots stay in `output/playwright/local-e2e/`. Traces, video, account storage snapshots, and request-body logs are disabled. Downloaded report bytes are checked in memory. The test closes its browser contexts and services. It removes only its own seed database and files.

## Remaining release work

This check covers the fixture claim and report flow. It does not cover every main product journey. Live Privy policy rejection, owner wallet confirmation, Graph context, model explanations, Circle funding, receipt exports, and hosted recovery require their own evidence. The full staging load check and complete keyboard review also remain separate requirements.
