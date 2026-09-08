# Implementation status

Updated: 8 September 2026

The full submission objective remains active. Live Graph indexing and the initial Arc deployment checks pass. Full user journeys remain incomplete.

| Package | Status | Evidence |
| --- | --- | --- |
| WP-01 Foundation | IN_PROGRESS | Workspace, local infrastructure, provider preflight, service start command, test groups, and pinned CI workflow created. Root lint, type checks, builds, and unit checks pass. The full integration rerun passes. CI execution remains pending. |
| WP-02 Domain and database | IN_PROGRESS | Strict schemas, policy hashing, 34 database tables, and fifteen applied migrations. OpenAPI generation pending. |
| WP-03 Escrow | IN_PROGRESS | Contract implemented. Financial suite: 17 passing tests, including 256-run fuzz cases. Arc Testnet deployment verified. Draft approval and durable funding are connected through the API and worker. Database and failure-path tests pass. The live bounty funding test remains pending. |
| WP-04 Budget controller | IN_PROGRESS | Controller registration, owner controls, exact policy approval, durable allocation, and cumulative limits pass local tests. Five live Privy permission checks pass. Live owner transactions and Circle allocation remain pending. |
| WP-05 Identity and Privy | IN_PROGRESS | Live login, current role checks, and user wallet transfers work. The organization wallet has a verified Privy owner and policy. Live signing checks accept an allowed approval and reject an unapproved spender. Bounty funding remains pending. |
| WP-06 Graph data | IN_PROGRESS | One shared schema indexes three live vaults. The Studio query returns fresh observations without indexing errors. |
| WP-07 Coverage intelligence | IN_PROGRESS | Deterministic coverage calculations, source checks, and exact approved policy selection pass tests. Durable database updates and rule-based explanations work. The model adapter, saved requests, current-source checks, and source validation pass local tests. Live model verification needs credentials. |
| WP-08 Confidential service | IN_PROGRESS | Fixed fixture assessment, atomic encrypted file storage, service tokens, and payment-gated report access implemented. The report service runs separately on port 4190 and creates organization keys. Encrypted fixture admission, signed assessment, and separate report download services pass a full local chain test. Live operation remains pending. |
| WP-09 Settlement worker | IN_PROGRESS | Funding confirms the canonical Arc receipt and exact approval, funding, and USDC transfer events. It saves signed bytes before broadcast and resumes the same intent after a lost response. The claim settlement core passes a local chain test. The queue and Circle execution connection are configured. Local tests also reconcile a payment collected outside the worker. The recovery receipt route verifies final expiry and refund events. It records refunds once and resolves matching report holds. Automatic recovery now scans final events, saves Circle requests, and resumes after a restart. A real local queue test reaches a final refund. Live claim and recovery evidence remain pending. |
| WP-10 Circle agent | IN_PROGRESS | Circle CLI 1.0.0 is authenticated. The agent wallet received test USDC and deployed the escrow. Bounded allocation passes local tests with the Circle argument format. Live allocation remains pending. |
| WP-11 Application | IN_PROGRESS | Responsive workspace, live Privy login, organization and program setup, vault coverage, and wallet transfers work. The new bounty page prepares signed fixtures, downloads cases, approves terms, and requests Privy funding confirmation. Its live browser test waits for the Mac to be unlocked. |
| WP-12 Deployment and evidence | IN_PROGRESS | Live sponsor evidence is saved. Local retention and an isolated database, ciphertext, and key restore pass checks. Hosted backups, deployment, financial recovery, and submission assets remain pending. |

## Environment

Node 24.16.0, Docker 28.3.3, and Foundry 1.3.5-foundry-zksync-v0.1.9 are available. The repository started without Git history. The approved specification is preserved in its first commit.

## Stack decision

Keep the user-approved React/Vite, Fastify, and PostgreSQL architecture. A single hosted-site starter cannot replace the separately isolated verifier and report services. No Sites scaffold or hosted resources have been created.

## Dependency versions

Solidity 0.8.30, OpenZeppelin Contracts 5.6.1, viem 2.56.3, Zod 4.5.4, TypeScript 7.0.2, Vitest 5.0.0, and libsodium-wrappers-sumo 0.8.4 are locked.

## Open input

Privy app configuration is stored in the ignored .env file with mode 0600. Graph email verification and Circle testnet sign-in are complete. Model access and hosting still need setup. No secrets are stored in Git.

## Current verification

- The latest development recovery stage passes all 129 TypeScript tests in 21 files. These tests include real PostgreSQL transactions, local chain settlement, concurrent allocation jobs, current role checks, encrypted storage integrity, exact payment gating, owner controls, retention, isolated restore, expiry/refund receipt recovery, checkpoint replay, and durable automatic recovery.
- Pass 17 Solidity tests with Foundry v1.5.0 in the foundation stage.
- Pass TypeScript type checking.
- Pass the production frontend and Graph package builds after the foundation changes. Vite reports one large dependency chunk.
- Pass repository-wide lint for 167 source and configuration files. Pass all 36 unit tests in nine files. The full suite also passes after Docker recovery and the test-chain history change.
- Open the live Privy login window through the new app. The user has signed in to the local workspace. Financial user journeys remain pending.
- Check the desktop landing page and the 390-pixel mobile page. Mobile scroll width equals viewport width. Browser evidence is in the ignored output/playwright folder.

## Local services

The frontend uses http://127.0.0.1:5173. The API uses port 4187. PostgreSQL uses port 5433. The configured service group is running after Docker recovery. The API health check and worker provider startup check pass.

## Provider references

- [Privy React quickstart](https://docs.privy.io/basics/react/quickstart) defines login and embedded wallet setup.
- [Privy access tokens](https://docs.privy.io/authentication/user-authentication/access-tokens) defines server token verification.
- [Circle Agent Wallet quickstart](https://developers.circle.com/agent-stack/agent-wallets/quickstart) defines the separate testnet email login.
- [Circle CLI](https://developers.circle.com/agent-stack/circle-cli) defines the supported agent wallet interface.

## Live deployment evidence

- Graph: `evidence/the-graph/live-query.json` records all three live source vaults.
- Arc: `evidence/arc/escrow-deployment.json` records the successful transaction, canonical block, deployed code hash, USDC asset, and zero initial liability.
- Escrow: `0x01742711ee569a0186349e54cffe805209808292` on Arc Testnet.

## Coverage workflow

The signed-in demo workspace registers Sky sDAI, Sky sUSDS, and Ethena sUSDe. The owner approved a minimum reward of one test USDC per vault. The worker stores live observations and coverage decisions. All three decisions correctly stop funding because no exact bounty policy has approval.

The PostgreSQL job queue runs a source update each minute. Vault registration and policy approval also create durable update requests. Provider failures invalidate saved funding actions. Concurrent delivery keeps one observation and one equivalent current decision.

## Reward wallet workflow

The user created a Privy embedded wallet through the application. The backend checked the provider user record before it saved the wallet. Circle sent two test USDC to that wallet. The user wallet then sent 0.01 test USDC back to the Circle wallet through Privy.

The final transfer hash is `0x40db171697dbaa32160e5816531b1ff302d6baabd268f89dfebf15db77a93a1a`. Evidence is in `evidence/privy/outgoing-transfer.json`. This is a wallet transfer. It is not a bounty payout or a report-release test.

Direct Arc RPC calls fail in the user's browser. The app uses a bounded Arc RPC relay. Read calls use an allowlist. A signed transfer must match a saved sender, nonce, chain, token, and calldata. The relay saves its hash before broadcast. A lost provider response leaves the intent in SUBMITTED state. The app can check the saved hash again. It does not create a new transfer to recover from that failure.

A final transaction requires a canonical block, the finalized head, and the exact USDC Transfer event. Bounty funding and confidential settlement still need integration.

## Signed bounty preparation

The API prepares three synthetic cases for each manifest. The owner signs the exact manifest message with a verified Privy wallet. A draft binds the signed root, source context, verifier code hash, verifier configuration, signers, organization report key, refund wallet, reward, and deadlines. The refund wallet must belong to the organization. A personal wallet cannot satisfy that requirement.

The database rejects changes to signed manifests, approved bounty terms, and approved coverage policy versions. Four integration tests cover the signed-manifest and draft-approval flow. They use isolated test identities and a test organization wallet. Live bounty funding remains pending.

The report service has its own identity and key directory. It authenticates API requests before creating an organization key. Concurrent requests return one public key. The API does not receive the private report key. Start this service with `pnpm dev:reports` after `pnpm setup:keys`.

## Organization funding wallet

The demo organization has wallet `0x6dd9e77782bbb10268abfa04663a062f3ca30768`. The owner approved a limit of five test USDC per action. Privy restricts signing to Arc Testnet, the USDC approval function, and the escrow funding function. The policy fixes the approval spender and the funding organization. It also limits the amount. The application checks current organization roles. Privy does not enforce application roles.

Setup saves each provider result before the next step. Retries reuse the saved policy and wallet. An expired provider request requires operator review. Funding must require READY state and a fresh provider-policy check. The provisioning tests use a separate database. The live worker cannot consume these test requests.

Direct Privy broadcast returns an Arc chain authorization error for this app. The integration uses `eth_signTransaction` with the same restrictions. The signer and every transaction field are checked before a signed transaction enters the broadcast workflow. This approach follows the [Privy transaction signing interface](https://docs.privy.io/wallets/using-wallets/ethereum/sign-a-transaction).

Live evidence is in `evidence/privy/treasury-signing-policy-92a15f31-8003-4cfd-a30a-103eb855fe6d.json` and `evidence/privy/treasury-allowed-signing-92a15f31-8003-4cfd-a30a-103eb855fe6d.json`. Privy rejects a zero-amount approval to an unapproved spender with `policy_violation`. Privy signs a zero-amount approval to the approved escrow. Neither check broadcasts a transaction. These checks do not prove bounty funding or nested funding-field enforcement.

Four additional live checks exercise the funding function. Privy signs the allowed request. It rejects the wrong organization, wrong asset, and an amount above the cap. The files `evidence/privy/treasury-funding-*.json` record these checks. They prove policy evaluation for the nested funding fields. They do not prove an on-chain bounty funding transaction.

## Durable bounty funding

An owner or treasury member prepares a funding request for an approved draft. The requesting member confirms the exact message with a currently linked Privy wallet. The message binds the full policy, request ID, actor, funding wallet, expiry, and fee cap. Cancellation before confirmation creates no funding job.

The worker checks the current role and live provider policy before a new signature. It saves the transaction intent, nonce, signed bytes, and hash before broadcast. A lost response reuses that transaction. It does not select a new nonce. The worker requires the exact approval event before sending the funding transaction. It records a funded bounty and receipt only after the canonical finalized transaction proves both `BountyFunded` and the exact USDC transfer.

The database prevents changes to saved funding authorization terms, transaction terms, and signed bytes. A wallet lock prevents concurrent funding execution. The API exposes a retry for the saved request. An expired authorization cannot sign another transaction. A final revert requires operator review.

The Circle wallet sent two test USDC to the organization wallet. The final transfer hash is `0x49067eaf9a721497f810edaaa213851ca4375366009a76f745a9ab1b1c161161`. The canonical finalized receipt and exact transfer event are verified in `evidence/arc/treasury-seed.json`. This is a wallet deposit. It is not bounty funding.

The live browser funding test is incomplete because the Mac is locked. The user has been asked to unlock it. The full submission goal remains active.

## Encrypted claim journey

The API accepts only ciphertext for a claim. It binds the file hash, size, verifier key, bounty, and current researcher wallet. The verifier decrypts the file in its own service. It accepts only a case from the signed synthetic manifest. It does not run user code or fetch a supplied target.

The verifier saves two separately encrypted report copies before it signs an assessment. The researcher report service checks claim ownership. The organization report service checks current membership and final payment. An organization role does not grant early access to the organization copy.

Three integration tests use an isolated database and a local chain. They cover malformed evidence, both nonqualifying controls, a qualifying payment, report integrity, role removal, and a report service failure after payment. A retry releases the report without another payment. All 72 TypeScript tests pass. The live Circle claim test and browser claim test remain pending.

## Claim worker and browser controls

The local worker now consumes durable claim jobs. It uses the configured Circle agent wallet on Arc Testnet. It restricts calls to the configured escrow and the three claim functions. Each stage derives one provider request ID from its saved claim ID. It checks the returned wallet, chain, contract, and request ID. Final receipt checks determine payment status.

Circle CLI 1.0.0 needs a small local package patch to accept JSON arrays as tuple arguments. The patch changes only argument parsing for `wallet execute`. Circle supports array values in [contract execution parameters](https://developers.circle.com/api-reference/wallets/user-controlled-wallets/create-user-transaction-contract-execution-challenge). A test uses the installed parser and confirms that each claim call preserves all signed fields. The lock file records the patch.

The browser accepts the downloaded synthetic case bundle. The user selects one case and a verified reward wallet. The browser encrypts the case before upload. A failed upload retries the saved encrypted bytes and request ID while the page stays open. Reload recovery remains pending.

The reports page shows personal claim status and separate researcher report downloads. Organization report downloads require final payment. The production frontend build passes. Live browser checks remain pending while the Mac is locked.

The local verifier listens on port 4191. Researcher reports use port 4192. The organization report service uses port 4193. The internal report release service remains on port 4190. These local endpoints are not a hosted submission.

## Coverage assistant

The coverage page accepts questions about registered vault funding and source freshness. Each request saves its question, source snapshot, fixed calculation, prompt version, model ID, and input hash. The worker uses the OpenAI Responses API with a strict JSON output schema. It supplies no tools. It sends no report, evidence file, wallet key, or organization name.

The server checks every returned decision, amount, and source reference against the saved snapshot. It rejects changed calculations and invented citations. Model prose cannot add numeric amounts or links. The interface renders amounts and source links from checked fields. The model cannot create or execute a funding action.

The worker checks current source and funding records before and after generation. A changed record makes the answer stale. The read API checks freshness again. Current organization membership is required for each read. Request terms and completed answers are immutable in the database.

Seven new tests use a simulated model provider and an isolated database. They cover immutable requests, malicious metadata removal, exact large numbers, access control, rejected model output, provider failure, changed source records, removed members, and the Responses API request shape. These are local integration checks. They do not prove live model behavior or sponsor qualification.

The live model gate remains incomplete. `MODEL_API_KEY` and `MODEL_ID` are empty in the local configuration. The interface states that the model is not configured. The browser remains unavailable while the Mac is locked.

## Report download integrity

The browser now compares downloaded report bytes with the report hash from authenticated metadata. It creates a download only after the hash matches. A unit test changes a byte and verifies rejection. The claim journey tests still pass. This completes the byte-check implementation for PRI-05. The live browser check remains pending.


## Bounded budget allocation

The API registers a controller only after it checks the finalized deployment, exact creation code, and constructor fields. The database preserves the organization, owner, operator, asset, escrow, and deployment proof. The registration check supports direct creation and Circle factory creation. Factory checks bind the exact creation code and constructor to the deployed address. They also check the pinned factory code, creation event, prior empty address, runtime code, and immutable fields.

An approved draft can return unused funds to its organization wallet or its registered controller. The API requires exactly one refund destination. The controller approval must match the exact draft hash and reward. The allocation worker checks fresh Graph context, the current coverage policy, the current chain approval, the controller balance, the spending limits, and the operator gas reserve.

The worker saves one immutable Circle request before it calls the provider. It checks finalized `BudgetAllocated`, `BountyFunded`, and token transfer events before it records funding. A lost response can reconcile the existing allocation. Concurrent jobs cannot send two allocations for one controller. A pending request can retry through the API with its original transaction terms.

The worker refreshes registered controllers and queues current recommendations only when the controller is enabled. The owner must approve the exact policy on chain. The language model has no allocation authority. Controller owner controls and their Privy policy extension remain pending.

Eleven budget tests pass. They cover lost responses, concurrent jobs, daily spending, per-action limits, disabled controllers, absent approval, stale sources, deployment bindings, and the installed Circle tuple parser. The full 83-test suite passed before the factory change. All eleven budget tests and type checking pass after that change. These allocation tests use local chains and a simulated Circle response. They do not prove live Circle allocation.


## Circle controller deployment

Circle deployed controller `0x999c73e9bb9f70013f7a20cddd97c9633b094dda` on Arc Testnet. Transaction `0x66863e8a40c34811e1427202db91bb64a1270ccc9e3e246cb862e74ccb87d4a2` is finalized. The controller is disabled. Its token balance and spending limits are zero. Its owner is the existing organization Privy wallet. Its operator is the existing Circle service wallet.

The deployment script checks the testnet chain and fee estimate before deployment. It saves one provider request ID and the returned transaction before registration. A retry reuses the saved result. The script does not approve policies, deposit funds, or enable allocation.

The factory uses the address derivation defined by [EIP-1014](https://eips.ethereum.org/EIPS/eip-1014). The adapter checks the creation code, constructor, event salt, and factory address against the deployed address. It pins the factory runtime hash observed on Arc. It also checks the controller runtime template and all five immutable fields.

Evidence is in `evidence/arc/controller-c9d8a04b-4f44-4336-846d-4d484e4dc8f4.json`. This proves deployment and registration. Owner controls, a live approved allocation, and a live rejected limit case remain pending.


## Budget workspace

Organization settings now show the registered controller, available budget, spending limits, source time, policy approvals, and allocation history. Members can refresh chain state. Owners and treasury members can check existing owner approvals and retry a pending allocation. The API checks the current role and keeps retries idempotent. A new API test covers these access and retry rules.

A bounty draft can select the organization wallet or the coverage budget as its funding source and refund destination. A budget draft does not show the direct wallet funding button. It requires the exact controller approval. Owner controls for deposits, policy approval, limits, and enablement remain pending.

Type checking, changed-file lint, and the frontend build pass. The new budget API test passes. The browser check remains pending while the Mac is locked. These screens do not complete the live allocation journey.

## Owner controls

Owners can prepare deposits, withdrawals, limits, policy approvals, and enable/disable requests in the budget workspace. Each request requires a signature from the requesting owner's current Privy wallet. The message binds the complete action and expires after ten minutes. The worker checks the role, linked wallet, command, balance, provider policy, and controller before signing.

The worker grants a temporary Privy permission after saving the transaction intent. It saves signed bytes, restores the base policy, and then broadcasts. Recovery uses the same transaction and nonce. Cleanup still runs after owner removal. A failed cleanup stops broadcast. A queued action can cancel before signing starts. An unresolved transaction after authorization expiry still requires reconciliation.

Privy fixes every argument for deposits, withdrawals, limits, and policy approval. For enable/disable, Privy restricts the chain, zero native value, controller, function, and expiry. The application checks the selected Boolean state against the signed owner message and returned transaction. Privy does not enforce that Boolean state in this integration. The confirmation message discloses this boundary.

Five live permission checks pass. The four numeric actions reject a changed amount. The enable/disable action rejects another destination. Each check restores the original wallet policy. No check broadcasts a transaction or moves funds. Evidence is in `evidence/privy/owner-policy-0e36ddc6-5cfa-46cf-8c2f-6e9ad0d5fdb8-{enabled,limits,deposit,withdraw,approval}.json`. Earlier failed attempts remain in the evidence directory. They are not passing evidence.

Eighteen owner-control tests pass. They check database immutability, current roles, linked wallets, all five actions, lost broadcast responses, policy cleanup, event matching, queued cancellation, and shared nonce locking. The tests reject a signed enabled state that differs from the owner's confirmation. Rule tests compare argument names and values with the decoded contract ABI.

All 103 tests in 19 files pass in a clean full run. The first run exposed a test cleanup race. The assistant test now closes its database connections and drops its isolated database without forced disconnection. All 19 changed TypeScript files pass lint. Type checking and the production build pass.

The local API and worker run the owner controls. The API health check passes. Both owner queues exist. The Mac remains locked. The live browser flow, owner transactions, Circle allocation, and complete payout journey remain pending. Model credentials and hosting also remain open.

## Ciphertext retention and local recovery

The retention service deletes abandoned uploads after 24 hours. It schedules terminal claim evidence for deletion after seven days. Nonqualifying report copies expire after seven days. A qualifying report stays on hold while settlement is unresolved. Its first successful release starts a 30-day report period. A retry cannot extend that period.

The database preserves report commitments, paid retention dates, and completed deletion records. Cleanup records `DELETING` before removing ciphertext. It records `DELETED` after both report copies are removed. A failed file operation leaves a retryable deletion. Restored copies of deleted objects are removed again, including copies with recent file times. Financial receipts and report hashes remain.

Ciphertext writes and cleanup share a database lock. Cleanup rejects overlapping storage directories, including aliases. Old unreferenced ciphertext and pending files expire after 24 hours. The service does not read plaintext or require signing and decryption keys. Hosted permissions must isolate it from those keys.

The report interface shows the export deadline. Access checks reject expired reports. An unrelated user receives 404 before the expiry state is disclosed. Organization access still requires the exact final payment and current membership.

The local recovery test uses actual `pg_dump` and `pg_restore` operations. It restores an isolated database, encrypted files, and a report key. Expired data remains inaccessible and is removed. A current paid report still decrypts to its saved hash, and its receipt remains. This proves local PRI-06 behavior. It does not prove hosted backup custody or live-chain recovery.

The updated API, verifier, report service, and worker run locally. The retention process scans every ten minutes. Its first scan completes with zero due files. The API health check passes. See `docs/RETENTION_AND_RECOVERY.md` for periods, commands, and restore limits.

All 110 tests in 20 files pass in the final full run. The seven retention tests include interrupted deletion, restored objects, alias rejection, and an actual PostgreSQL restore. Type checking, changed-file lint, and the production build pass.

Hosted backups and backup expiry enforcement remain unimplemented. Canonical reservation-expiry recovery must resolve qualifying reports that cannot reach payment. Those reports stay on hold until that path exists. The full submission objective remains active.

## Expiry and refund recovery

The owner and treasury API accepts a known recovery transaction hash. It checks the configured chain, immutable bounty policy, final receipt, and exact refund transfer. It records a combined reservation expiry and refund in one database transaction. A retry cannot create a second receipt or extend a report deletion date.

A matching final expiry can resolve a qualifying report hold. The organization still cannot download the unpaid report. The database preserves the expiry event reference and seven-day retention period. An older expiry cannot replace a newer refund projection. Recovery uses the claim lifecycle lock and waits for an active assessment.

Local Anvil and PostgreSQL checks cover these paths, current roles, invalid receipt fields, saved event conflicts, and concurrent processing. Automatic recovery, event discovery, and the owner/treasury recovery screen are implemented. The real queue test records a final refund after an authorized retry. Lost-response tests preserve the provider key or resolve an already completed action from chain events. Qualified claimant credit remains untouched after cutoff. The recovery screen passes local desktop, mobile, keyboard, and receipt-input checks with synthetic API responses. Live Arc recovery evidence and the signed-in account journey remain incomplete. See `docs/RETENTION_AND_RECOVERY.md`.


## Development commands and CI

The root start command checks settings and ports. It starts six configured services and stops its children on termination or service failure. Isolated checks verify normal shutdown and shutdown after one child exits. Both checks confirm that every service port closes. A real startup attempt confirms that a database failure stops the group. A successful configured startup passes in the development recovery stage below.

Unit and integration tests now have separate Vitest projects. The full test command compiles contracts before tests. The CI workflow pins Node, pnpm, Foundry, and GitHub Action references. It runs local checks without provider credentials. No Git remote is configured, so no GitHub run is recorded.

The first full run passes 127 of 129 tests. Two budget tests reach their 30-second limit. Their local receipt polling interval is reduced to 50 milliseconds. Their assertions and time limits remain unchanged. The next run uses Foundry v1.5.0 but loses its database connection. It records 109 passes and 20 failures. This run does not prove the complete integration suite.

The disk check shows 142 MB free during the failure. Docker logs report a write failure with “no space left on device.” Removing this build's unused downloads and browser caches raises free space to about 762 MB. Project files and database volumes remain intact. At the end of that stage, Docker still did not respond. The development recovery stage below resolves this interruption.

All 36 unit tests, 17 Solidity tests, repository-wide lint, type checks, and production builds pass in this stage. See `evidence/local/development-checks.json` for the exact scope. Read `docs/DEVELOPMENT_CHECKS.md` for commands and limits.


## Development recovery

Docker restarts after package cache cleanup. PostgreSQL is healthy and the migrations apply. The configured service supervisor starts the app and all service ports. The worker confirms provider readiness. The API health check passes.

The first recovered full run passes 120 tests and fails nine historical state reads. The Anvil suites now retain up to 4096 historical states in memory. They do not write historical state files to disk. Existing assertions and finality checks remain unchanged. The final run passes all 129 tests in 21 files. Repository-wide lint and type checking pass.

Only test configuration and documentation change in this stage. The earlier 17 contract tests and production builds remain valid for the unchanged source. No new live financial journey is proved. GitHub CI execution, live journeys, hosting, backups, and submission assets remain open.

Evidence is in `evidence/local/development-recovery.json`.
