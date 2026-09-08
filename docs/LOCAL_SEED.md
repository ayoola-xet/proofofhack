# Local seed setup

`pnpm seed:local` creates a separate database and three funded synthetic bounties on Anvil. Anvil is the local Ethereum test node. This command uses no Privy, Circle, Graph, or model account.

## Start a seed

1. Start the local PostgreSQL service. Use the database setup in [Development checks](DEVELOPMENT_CHECKS.md).
2. Build the contracts with Foundry v1.5.0: `pnpm contracts:build`.
3. Start a separate Anvil node in another terminal:

```sh
anvil --host 127.0.0.1 --port 8547 --chain-id 31337 --prune-history 4096
```

4. Check the seed settings. Use a new database name for each seed:

```sh
APP_ENV=local \
LOCAL_RPC_URL=http://127.0.0.1:8547 \
LOCAL_SEED_DATABASE_URL=postgres://vulnproof:vulnproof_local@127.0.0.1:5433/vulnproof_seed_demo \
pnpm seed:local --check
```

5. Run the same command without `--check` to create the seed.
6. Keep that Anvil process running while you use the seed. Its state is temporary. A new Anvil process needs a new seed database name.

The database user needs permission to create databases. The command applies the repository migrations to the new database. It does not load `.env` or use `DATABASE_URL`. It does not change the configured Arc demo.

The command requires an explicit loopback IP address and port for both services. It rejects URL query parameters. The database name must start with `vulnproof_seed_`. The node must report chain ID `31337` and an Anvil client version before any write occurs. The local token contract also rejects other chain IDs.

## Seed records

The seed creates five separate local identities: owner, treasury manager, reviewer, researcher, and outsider. The first three have organization membership. The researcher and outsider have no organization membership.

It creates an organization, program, organization report key, service identities, verifier keys, and three fixture cases. It deploys `TestUSDC` and `BountyEscrow`. Each bounty receives one local test USDC. Each bounty uses the actual verifier source commitment and the generated fixture root.

The command checks each bounty at the final local block. It checks the funding event fields before saving the bounty, event, and receipt records. It does not seed a payment or report release. Those transitions require a claim.

The synthetic source address is a fixture reference. It is not a deployed source vault or a live Graph observation. No live coverage record or model response is fabricated.

## Saved files

The command saves files in `.local/seeds/<database-name>/`. Git ignores this directory. Files have private permissions.

| File | Purpose |
| --- | --- |
| `scope.json` | Local chain, database name, and creation time |
| `seed.json` | Completion record, user and wallet IDs, bounty policies, and final funding references |
| `fixtures.json` | Qualifying, zero-discrepancy, and below-threshold synthetic fixtures |
| `actors.json` | Local authentication tokens and local wallet keys |
| `public-services.json` | Public service keys and verifier commitments |
| `verifier-secrets.json` | Local admission, assessment, and encryption keys |
| `*-identity.json` | Separate local service identity keys |
| `organization-keys/` | Organization report decryption key |
| `runtime.json` | Private local database connection and file directory |

Wallet records use local test substitutes for provider identities. Their IDs start with `local-seed:`. The completion record states `LOCAL_TEST_DOUBLES` and `liveSponsorEvidence: false`.

Use these files for local service and integration development. This command does not start a browser session or replace the Privy sign-in flow. The normal `pnpm dev` command still requires the configured sponsor environment. A full browser release check remains separate.

## Retry and failure

A repeated seed name fails before any new transaction. The command does not replace files, reset a database, or reset Anvil. After a partial failure, preserve the files for inspection and use a new seed name. A missing `seed.json` means setup did not complete. The command does not claim that partial records are ready.

## Verification

The integration check starts a separate Anvil process and a temporary database. It runs the actual seed command. It checks all three final bounties, three receipts, five identities, organization access, and private file permissions. It checks that a repeated seed sends no transaction. A separate check returns a public chain ID and verifies rejection before database creation.

```sh
pnpm exec vitest run tests/local-seed.test.ts tests/local-seed-scope.test.ts
```

The test removes only its own database and seed files. The Anvil history limit prevents the large temporary state files found during the storage cleanup.
