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
| `pnpm build` | Web application and Graph package | None |
| `pnpm test:unit` | Tests without PostgreSQL | None |
| `pnpm test:integration` | PostgreSQL, local-chain, queue, encryption, and recovery tests | Local PostgreSQL and Docker |
| `pnpm test` | All unit and integration tests | Local PostgreSQL and Docker |
| `pnpm test:contracts` | Solidity contract tests | Foundry |

The application and integration test commands compile contract artifacts first. Anvil tests use temporary local chains. They do not use Arc funds. The retention restore test uses `docker exec` with `vulnproof-postgres-1`. Use the documented Compose project name. Apply migrations before running the tests.

Use a disposable local database for integration tests. Several tests use shared tables in that database. Other tests create and remove separate databases. Never set `DATABASE_URL` to a hosted or production database for these tests.

The local budget tests check transaction receipts every 50 milliseconds. This avoids the slower default polling interval on a local chain. Their existing time limits and assertions remain in place.

## Lint scope

Drizzle owns the generated migration metadata format. Biome excludes that metadata directory. Biome still checks migration source files that it supports.

The Graph mapping uses AssemblyScript. Its imports must remain valid for that compiler. The mapping therefore disables the TypeScript `useImportType` rule. The Graph build checks the mapping.

The shared stylesheet has selectors for separate page components and intentional state variants. Biome's `noDescendingSpecificity` rule compares some selectors across those component boundaries. That rule is disabled only for this stylesheet. Other stylesheet checks remain enabled.

## Release limits

These commands prove local behavior. They do not prove the live owner, claim, settlement, report, or recovery journeys. The live model check, hosted deployment, backup controls, and submission assets remain required. Dedicated `test:e2e`, `test:live`, `seed:local`, and `evidence:validate` commands remain unimplemented.
