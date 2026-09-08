# Development checks

## Tool versions

Use Node.js 24.16.0 and pnpm 10.32.1. Use Foundry v1.5.0 for `forge` and `anvil`. The contracts use Solidity 0.8.30. The dependency lock file fixes the package versions.

The CI workflow pins each GitHub Action to a commit. It uses Ubuntu 24.04. It installs dependencies from the lock file. It runs migrations, lint, type checks, builds, contract tests, and application tests. It removes its local database volume when the job ends. It does not use provider credentials or make live payment requests.

A workflow file does not prove a successful GitHub run. This checkout has no Git remote. A GitHub run remains required after the repository is connected.

## Start the app

1. Complete `.env` and the service key configuration. Use the keys that match the deployed contracts.
2. Start PostgreSQL with `docker compose --project-name vulnproof -f infra/compose.yaml up -d --wait`.
3. Run `pnpm db:migrate`.
4. Run `pnpm dev --check`.
5. Run `pnpm dev`.
6. Wait for the HTTP service message and the worker provider message.
7. Open `http://127.0.0.1:5173`.

The start command runs six services as one managed group. It supports macOS and Linux. It requires a configured provider environment. It does not create accounts, keys, deployments, or sample bounties. The web development proxy uses the default API and report ports. Keep those defaults for this command.

Press Ctrl+C to stop the group. The command sends a termination signal to its child services. It allows up to 30 seconds for cleanup. It then stops any remaining child processes. It also stops the group if one child exits. It does not stop another service that already uses a required port.

`pnpm dev --check` checks required settings, the public configuration file, and available ports. It does not verify credentials, chain state, or database migrations. The services perform their own startup checks.

## Test commands

| Command | Scope | Required services |
| --- | --- | --- |
| `pnpm lint` | Source style and root TypeScript configuration | None |
| `pnpm typecheck` | TypeScript types | None |
| `pnpm build` | Generated API contract, web application, and Graph package | None |
| `pnpm openapi:check` | OpenAPI validity, exact generated files, and registered route inventory | None |
| `pnpm test:unit` | Tests without PostgreSQL | None |
| `pnpm test:integration` | PostgreSQL, local-chain, queue, encryption, and recovery tests | Local PostgreSQL and Docker |
| `pnpm test` | All unit and integration tests | Local PostgreSQL and Docker |
| `pnpm test:contracts` | Solidity contract tests and random-action financial invariants | Foundry |
| `pnpm test:e2e` | Real browser fixture claim, payment, and report access flow with local provider substitutes | Local PostgreSQL, Foundry, and Chromium |

The application and integration test commands compile contract artifacts first. Anvil tests use temporary local chains. They do not use Arc funds. The retention restore test uses `docker exec` with `vulnproof-postgres-1`. Use the documented Compose project name. Apply migrations before running the tests.

Use a disposable local database for integration tests. Several tests use shared tables in that database. Other tests create and remove separate databases. Never set `DATABASE_URL` to a hosted or production database for these tests.

The local budget tests check transaction receipts every 50 milliseconds. This avoids the slower default polling interval on a local chain. Their existing time limits and assertions remain in place.

The three Anvil suites use `--prune-history 4096`. This keeps up to 4096 historical states in memory and disables historical-state files on disk. The test chains stay within this limit. Historical finality checks still run. This avoids failed reads from archived test state and limits temporary disk growth.

## Lint scope

Drizzle owns the generated migration metadata format. Biome excludes that metadata directory. Biome still checks migration source files that it supports.

The Graph mapping uses AssemblyScript. Its imports must remain valid for that compiler. The mapping therefore disables the TypeScript `useImportType` rule. The Graph build checks the mapping.

The shared stylesheet has selectors for separate page components and intentional state variants. Biome's `noDescendingSpecificity` rule compares some selectors across those component boundaries. That rule is disabled only for this stylesheet. Other stylesheet checks remain enabled.

## Release limits

These commands prove local behavior. They do not prove the live owner, claim, settlement, report, or recovery journeys. The live model check, hosted deployment, backup controls, and submission assets remain required. The `test:e2e` command checks the local fixture claim and report flow at desktop and mobile widths. See [Browser checks](BROWSER_CHECKS.md). It does not yet cover every release journey. `seed:local` creates a separate local database and funded synthetic bounties. See [Local seed setup](LOCAL_SEED.md). The read-only live check and evidence validator are described below.


## Deployment containers

Read [container deployment](CONTAINER_DEPLOYMENT.md) for the separate container stack. `pnpm containers:prepare` creates an ignored local check environment. `pnpm containers:check` checks the running stack and saves its results. The check validates local TLS, public route restrictions, file permissions, and deployment environment guards. It uses a separate database and excludes financial provider credentials. It does not replace the live release scenario.


## Release evidence commands

`pnpm evidence:manifest` indexes the thirteen selected capture files in `evidence/live-manifest.json`. The index records the selected sponsors, Arc Testnet asset, source commit, file hashes, trust limits, and remaining release requirements. This index deliberately records `submissionReady: false`. The final acceptance audit must replace this incomplete state before release.

`pnpm evidence:validate --files-only` checks the index schema, expected artifact paths, exact file hashes, and known credential fields. Evidence paths must stay inside the evidence directory. Symbolic links cannot escape that directory. These checks detect common credential fields. They do not replace a full privacy review of public source and evidence.

`pnpm evidence:validate` also checks release gaps and the saved live read result. Exit code `0` is limited to the file-only check while release requirements remain open. Exit code `1` means invalid evidence files. Exit code `2` means that release requirements remain incomplete. A failed, missing, or changed-index live read result cannot satisfy its check.

Run `LIVE_READ_ONLY=arc-testnet pnpm test:live` to recheck the public provider data. The environment must also set `ARC_CHAIN_ID=5042002`, `ARC_USDC_ADDRESS=0x3600000000000000000000000000000000000000`, `GRAPH_ENDPOINT`, and `GRAPH_DEPLOYMENT_ID`. The Graph settings must match the indexed deployment. The optional Graph key uses `GRAPH_QUERY_KEY`.

The command uses read-only Arc requests and a Graph query. It needs no database, browser session, signing key, or wallet confirmation. It checks the escrow deployment receipt and code at deployment and at the final head. It checks all three Graph vaults and their observation and indexed-head ages. Both ages must be at most five minutes. Future times have a thirty-second tolerance.

The command also checks seven financial receipt events, seven claim events, and the post-payment token transfer. It compares the saved transaction, block hash, block number, contract, event name, and selected event fields. It links the outgoing sender to the paid claimant and checks block order. Duplicate matching events fail. The command sends no transactions.

The result is saved in `evidence/live-read-checks.json`. A provider error or mismatched event gives a failed result. Provider error bodies are omitted. These checks do not repeat browser login, wallet authorization, confidential report access, model generation, policy rejection, or limit simulations. A passing read-only check does not establish submission readiness.

After a selected capture changes, review it and rebuild the index. Then run the live check against that index. Each capture keeps its original scope and time. The index does not turn historical evidence into a current provider check.

The CI workflow installs Chromium, runs both local browser projects, and saves sanitized result files and synthetic UI screenshots. The workflow has not yet run on GitHub.

The [financial invariant test guide](FINANCIAL_INVARIANTS.md) describes the escrow model, random actions, exact seed, and recovery assertions. The contract command runs the invariant test in CI.
