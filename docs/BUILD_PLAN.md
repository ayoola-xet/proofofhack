# Build plan

Version: 1.0.0

## 1. Delivery method

Build complete user flows in dependency order. The work packages below can have separate team owners. Shared schemas and financial rules must be agreed before their implementations diverge. Do not interpret team capacity as permission to change the product scope.

Maintain `docs/IMPLEMENTATION_STATUS.md` throughout the build. Use `NOT_STARTED`, `IN_PROGRESS`, `PASS`, `FAIL`, and `BLOCKED`. Record exact provider failures and missing inputs. Do not report a blocked live requirement as completed.

## 2. Work packages

| Package | Output | Dependency | Exit condition |
| --- | --- | --- | --- |
| WP-01 Foundation | Monorepo, pinned runtime, formatting, types, CI, local containers, environment template | None | Clean install, build, lint, and type check |
| WP-02 Domain and database | Schemas, migrations, canonical hashes, fixtures, generated OpenAPI | WP-01 | Hash vectors and schema tests pass |
| WP-03 Escrow | Non-upgradeable bounty contract and contract client | WP-02 | Escrow tests and stateful financial invariants pass |
| WP-04 Budget controller | Approved policy allocation and spending limits | WP-03 | Allocation, concurrency, and limit tests pass |
| WP-05 Identity and Privy | Authentication, roles, wallets, provider policy, user transfers | WP-02 | Authentication tests and live allowed/blocked wallet actions pass |
| WP-06 Graph data | Deployed standardized package and source client | WP-02 | Live multi-vault query and freshness checks pass |
| WP-07 Coverage intelligence | Deterministic coverage engine and model explanation | WP-06 | Cited recommendation and abstention evaluations pass |
| WP-08 Confidential service | Encrypted upload, fixed fixture verifier, report construction | WP-02 and WP-03 | Fixture, integrity, and logging tests pass |
| WP-09 Settlement worker | Durable jobs, admissions, reconciliation, collection, release | WP-03, WP-05, WP-08 | Full qualifying and control journeys pass |
| WP-10 Circle agent | Documented Circle wallet path and bounded allocation | WP-04 and WP-07 | Live Circle allocation and rejected limit case pass |
| WP-11 Application | Required screens, receipts, responsive states, accessible flows | WP-02 onward | Browser journeys and UI review pass |
| WP-12 Deployment and evidence | Service deployment, restore test, sponsor evidence, demo assets | All required packages | Live release matrix passes or accurately records blockers |

## 3. First implementation sequence

1. Read the full package. Record scope and trust limits in implementation status.
2. Inspect the actual workspace. Preserve any existing files and uncommitted work.
3. Create the monorepo, shared schemas, and local development stack.
4. Define and test canonical policy, fixture, and report encodings.
5. Implement escrow and the budget controller. Complete financial invariant tests.
6. Implement authentication and real wallet provider adapters.
7. Complete one local qualifying claim from encrypted upload to report release.
8. Complete the control case and failure recovery before expanding the UI.
9. Deploy and validate the Graph coverage package with live provider data.
10. Implement the coverage assistant and Circle allocation flow.
11. Complete live Privy, Arc, and Circle transactions on testnet when configured and authorized.
12. Finish all required screens, receipts, evidence, and operational checks.

Do not postpone settlement correctness until after visual polish. Do not construct a UI success state before the underlying operation exists.

## 4. Integration gates

### Gate A. Provider capability

Confirm that the configured Privy wallet path can apply the required control and send the required Arc transaction. Confirm the Circle wallet path can call the controller. Confirm source-network support at the selected Graph provider. Record sanitized outputs.

If an account is missing, continue independent local work. Ask only for the exact missing account or value. Do not repeatedly ask for approval already supplied by the user.

### Gate B. Financial core

Complete the escrow, controller, unit conversions, and transaction reconciliation tests. No live claim demonstration can proceed with failing financial invariants.

### Gate C. Confidential handling

Complete encryption, report derivation, role checks, storage-before-signing, delayed release, and logging tests. Verify that the product states `TRUSTED_SERVICE` and `FIXTURE_ONLY`.

### Gate D. Live product

Complete the end-to-end acceptance scenario with real selected integrations. Capture transaction evidence and provider references. Keep local and live results separate.

### Gate E. Submission readiness

Map every selected track to actual evidence. Recheck event rules, Classic eligibility, AI attribution, and source transparency. Prepare the main video and sponsor documentation. Do not submit or contact third parties without the user’s explicit authorization.

## 5. Required developer commands

Implement these root commands during scaffolding. They are required future interfaces, not commands that already work in this specification-only repository.

```text
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contracts
pnpm test:integration
pnpm test:e2e
pnpm test:live
pnpm db:migrate
pnpm seed:local
pnpm preflight
pnpm evidence:validate
```

`test:live` must require explicit environment configuration and testnet wallet scope. It must not use production accounts or transfer user funds unexpectedly. `seed:local` must refuse a non-local chain. `preflight` must validate dependencies without printing secrets.

## 6. Deployment outputs

Produce a checked deployment manifest with environment, chain IDs, asset address, contract addresses, deployment transaction hashes, compiler versions, source commit, provider package IDs, service URLs, and finality configuration. Keep secrets elsewhere.

Use an approved deployment host. Provide local containers even when deployment is blocked. Keep a deployer wallet separate from service and user wallets. Do not leave deployer keys in running application containers.

## 7. Mainnet readiness record

The Arc launch target requires a separate readiness assessment. `docs/MAINNET_READINESS.md` must identify the current status of:

- Independent contract and financial review.
- Verifier and report-service trust review.
- Supported network and asset configuration.
- Wallet ownership, signer controls, and key recovery.
- Limits on live funds and operational incident handling.
- Backups, report retention, restore tests, and monitoring.
- Mainnet provider support and deployment configuration.
- Honest public claims about confidentiality and fixture scope.

The reference product’s fixture verifier is not a production vulnerability verification system. State this in the readiness record. Do not mark broad production bounty verification ready because testnet settlement works.

## 8. Final build handoff

Return the working app URL or local start instructions, source locations, tested commit, deployment manifest, test summary, sponsor evidence, and a concise blocker list. State what is live, what is local, and what remains unimplemented.
