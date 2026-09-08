# Implementation status

Updated: 8 September 2026

The full submission objective remains active. Live Graph indexing, Arc claim settlement, Privy owner actions, and Circle budget allocation have verified evidence. Hosted operation, live reservation expiry, separate live actors, model access, and submission assets remain incomplete. A live automatic refund now has verified evidence.

| Package | Status | Evidence |
| --- | --- | --- |
| WP-01 Foundation | IN_PROGRESS | Workspace, local infrastructure, provider preflight, service start command, test groups, and pinned CI workflow created. Root lint, type checks, builds, and unit checks pass. The full integration rerun passes. CI execution remains pending. |
| WP-02 Domain and database | IN_PROGRESS | Strict schemas, policy hashing, 35 database tables, and eighteen applied migrations. OpenAPI generation pending. |
| WP-03 Escrow | IN_PROGRESS | Contract implemented. Financial suite: 17 passing tests, including 256-run fuzz cases. Arc Testnet deployment verified. Draft approval and durable funding are connected through the API and worker. Database and failure-path tests pass. The signed-in browser funds a one-test-USDC bounty on Arc. The live three-case claim journey completes. A live automatic refund has final receipt evidence. Live reservation expiry and hosted recovery remain pending. |
| WP-04 Budget controller | IN_PROGRESS | Controller registration, owner controls, exact policy approval, durable allocation, and cumulative limits pass local tests. Live Privy owner transactions configure limits, deposit funds, approve exact policies, enable allocation, and withdraw unused funds. Circle funds one test-USDC bounty. The worker and deployed controller reject the daily-limit control. |
| WP-05 Identity and Privy | IN_PROGRESS | Live login, current role checks, and user wallet transfers work. The organization wallet has a verified Privy owner and policy. Live signing checks accept an allowed approval and reject an unapproved spender. A signed-in owner authorizes and funds a one-test-USDC bounty on Arc. The paid claimant later sends one test USDC through the embedded wallet. |
| WP-06 Graph data | IN_PROGRESS | One shared schema indexes three live vaults. The Studio query returns fresh observations without indexing errors. |
| WP-07 Coverage intelligence | IN_PROGRESS | Deterministic coverage calculations, source checks, and exact approved policy selection pass tests. Durable database updates and rule-based explanations work. The model adapter, saved requests, current-source checks, and source validation pass local tests. Live model verification needs credentials. |
| WP-08 Confidential service | IN_PROGRESS | Fixed fixture assessment, atomic encrypted file storage, service tokens, and payment-gated report access implemented. The report service runs separately on port 4194 and creates organization keys. Encrypted fixture admission, signed assessment, and separate report download services pass a full local chain test. Live encrypted uploads, three case assessments, and paid report downloads complete. Hosted service isolation remains pending. |
| WP-09 Settlement worker | IN_PROGRESS | Funding confirms the canonical Arc receipt and exact approval, funding, and USDC transfer events. It saves signed bytes before broadcast and resumes the same intent after a lost response. The claim settlement core passes a local chain test. The queue and Circle execution connection are configured. Local tests also reconcile a payment collected outside the worker. The recovery receipt route verifies final expiry and refund events. It records refunds once and resolves matching report holds. Automatic recovery now scans final events, saves Circle requests, and resumes after a restart. A real local queue test reaches a final refund. Live claim evidence now verifies two rejections, one qualification, and exact payment. The live recovery worker returns an expired bounty reward to its fixed recipient. Live reservation expiry and hosted restore remain pending. |
| WP-10 Circle agent | IN_PROGRESS | Circle CLI 1.0.0 is authenticated. The agent wallet received test USDC and deployed the escrow. The live operator funds an exact approved policy using fresh Graph context. Final events prove the allocation and token transfer. A second approved policy exceeds the daily limit and creates no provider request. |
| WP-11 Application | IN_PROGRESS | Responsive workspace, live Privy login, organization and program setup, vault coverage, and wallet transfers work. The new bounty page prepares signed fixtures, downloads cases, approves terms, and requests Privy funding confirmation. Its live browser test creates signed fixtures, approves the draft, and funds a one-test-USDC bounty on Arc. The three-case claim journey and paid report downloads complete. Live budget controls and post-payment wallet transfer also complete. Organization and researcher receipt exports use final chain event checks. |
| WP-12 Deployment and evidence | IN_PROGRESS | Live sponsor evidence is saved. Local retention and an isolated database, ciphertext, and key restore pass checks. A separate local container stack now has TLS and file-access checks. Hosted backups, deployment, financial recovery, and submission assets remain pending. |

The records below describe successive build stages. Later records replace earlier pending states. The table above gives the current package summary.

## Environment

Node 24.16.0, Docker 28.3.3, and Foundry 1.3.5-foundry-zksync-v0.1.9 are available. The repository started without Git history. The approved specification is preserved in its first commit.

## Stack decision

Keep the user-approved React/Vite, Fastify, and PostgreSQL architecture. A single hosted-site starter cannot replace the separately isolated verifier and report services. No Sites scaffold or hosted resources have been created.

## Dependency versions

Solidity 0.8.30, OpenZeppelin Contracts 5.6.1, viem 2.56.3, Zod 4.5.4, TypeScript 7.0.2, Vitest 5.0.0, and libsodium-wrappers-sumo 0.8.4 are locked.

## Open input

Privy app configuration is stored in the ignored .env file with mode 0600. Graph email verification and Circle testnet sign-in are complete. Model access and hosting still need setup. No secrets are stored in Git.

## Current verification

- The latest full run passes all 149 TypeScript tests in 24 files. These tests include real PostgreSQL transactions, local chain settlement, concurrent allocation jobs, current role checks, encrypted storage integrity, exact payment gating, owner controls, retention, isolated restore, expiry/refund receipt recovery, checkpoint replay, and durable automatic recovery.
- Pass 17 Solidity tests with Foundry v1.5.0 in the foundation stage.
- Pass TypeScript type checking.
- Pass the production frontend and Graph package builds after the foundation changes. Vite reports one large dependency chunk.
- Pass repository-wide lint for the current source and configuration files. Pass all 36 unit tests in nine files. The full suite also passes after Docker recovery and the test-chain history change.
- Open the live Privy login window through the new app. The user has signed in to the local workspace. Live claim settlement and budget allocation now have separate evidence records.
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

The live browser funding test now completes. The owner signs the fixture manifest, approves the exact terms, and authorizes one test USDC. The funding transaction is `0xdf7bdf668bed86d952f4444722d947138b9055153fc9062b971091d2013beb59`. Claim settlement and report access remain under live verification. The full submission goal remains active.

## Encrypted claim journey

The API accepts only ciphertext for a claim. It binds the file hash, size, verifier key, bounty, and current researcher wallet. The verifier decrypts the file in its own service. It accepts only a case from the signed synthetic manifest. It does not run user code or fetch a supplied target.

The verifier saves two separately encrypted report copies before it signs an assessment. The researcher report service checks claim ownership. The organization report service checks current membership and final payment. An organization role does not grant early access to the organization copy.

Three integration tests use an isolated database and a local chain. They cover malformed evidence, both nonqualifying controls, a qualifying payment, report integrity, role removal, and a report service failure after payment. A retry releases the report without another payment. All 72 TypeScript tests pass. The live Circle claim test and browser claim test remain pending.

## Claim worker and browser controls

The local worker now consumes durable claim jobs. It uses the configured Circle agent wallet on Arc Testnet. It restricts calls to the configured escrow and the three claim functions. Each stage derives one provider request ID from its saved claim ID. It checks the returned wallet, chain, contract, and request ID. Final receipt checks determine payment status.

Circle CLI 1.0.0 needs a small local package patch to accept JSON arrays as tuple arguments. The patch changes only argument parsing for `wallet execute`. Circle supports array values in [contract execution parameters](https://developers.circle.com/api-reference/wallets/user-controlled-wallets/create-user-transaction-contract-execution-challenge). A test uses the installed parser and confirms that each claim call preserves all signed fields. The lock file records the patch.

The browser accepts the downloaded synthetic case bundle. The user selects one case and a verified reward wallet. The browser encrypts the case before upload. A failed upload retries the saved encrypted bytes and request ID while the page stays open. Reload recovery remains pending.

The reports page shows personal claim status and separate researcher report downloads. Organization report downloads require final payment. The production frontend build passes. Live browser checks remain pending while the Mac is locked.

The local verifier listens on port 4191. Researcher reports use port 4192. The organization report service uses port 4193. The internal report release service remains on port 4194. These local endpoints are not a hosted submission.

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

## Report HTTP integration fix

The internal report service now uses port 4194. Fetch blocks the previous port, 4190. A TCP connection test did not detect this failure. The service supervisor now checks HTTP access through Fetch. The bounty draft test also calls the report service through its real HTTP client. It no longer replaces that connection with an in-process request.

Invalid fixture signatures return a specific 400 response. They do not return a generic service failure. All 129 tests pass after these changes. Type checks, lint, and the production build pass. This evidence does not prove live claim settlement or hosted service isolation.

## Circle request identity

Circle contract execution requires a UUID v4 idempotency key. This key identifies retries of the same request. The previous adapter derived a version-5-shaped key from the action name. The live zero-control claim reached the provider but received `INVALID_ARGUMENT` with `Invalid request body`. The fee estimate passed. The provider transaction list returned no execute transactions before the change.

Claim settlement, budget allocation, and recovery now use the saved transaction intent ID as the provider key. PostgreSQL creates that ID as UUID v4 before the provider call. The adapter rejects other UUID versions. A database trigger prevents changes to Circle intent IDs. The separate internal service owner ID keeps its existing value.

This development change applies to the one rejected live reservation request. An installation with unresolved requests from the previous adapter must reconcile those requests before changing provider keys. An absent transaction hash alone does not prove that a provider request failed.

Source: [Circle contract execution requirements](https://developers.circle.com/api-reference/wallets/user-controlled-wallets/create-user-transaction-contract-execution-challenge).

The UUID v4 request also receives `Invalid request body`. The ID change meets the documented requirement, but it does not resolve the complete live provider failure. The original admission signature expires during diagnosis. The provider body and expired admission path still need verification. All 129 local tests, type checks, lint, and the production build pass with the immutable ID change.

## Circle contract call body and admission expiry

The provider reports `parse_body_failed` for the tuple parameter body. The pinned Circle CLI patch now encodes the same arguments into `callData` for agent contract execution. Circle accepts this body. The installed handler test checks the complete request body for reservation, assessment, and collection calls.

An admission authorizes a reservation for five minutes. If the final chain remains FUNDED after that authorization expires, the worker closes the unreserved claim as ADMISSION_EXPIRED. It preserves the request record. It does not change its signed terms or send another reservation. Retention can delete the expired evidence after its existing deadline. The local chain test covers a lost response and proves that no second provider call occurs after expiry.

The first live zero-control claim expires during diagnosis. Its provider execution fails fee estimation and has no on-chain transaction hash. A fresh zero-control claim completes through Circle on Arc. Its assessment rejects the case. Its report remains SEALED for the organization. The claimant downloads the report through the signed-in interface. The downloaded report has discrepancy zero. The below-threshold and qualifying live cases remain in progress.

All 131 TypeScript tests pass in this stage. Type checks, lint, and the production build pass. Separate live organization and researcher accounts, hosted isolation, and full submission evidence remain incomplete.

## Live three-case journey

The same bounty processes all three signed fixture cases on Arc Testnet. The zero-control case has discrepancy 0. The below-threshold case has discrepancy 500,000. Both cases receive no reward. The qualifying case has discrepancy 10,000,000. Its finalized payment transfers 1,000,000 USDC base units to the claimant. This equals one test USDC.

Payment transaction: `0x4a4855d9db78ac02c3e255009d97b0682a3feda5a1d391f32bbd3793938c31a4`. The paid report becomes AVAILABLE. Both control reports remain SEALED. The claimant downloads all three reports. The owner downloads the paid report. Both downloads of the paid report match its committed hash.

The evidence capture script checks the signed manifest, each downloaded report hash, final block hashes, exact event arguments, exact USDC payment, and report state. Evidence is in `evidence/arc/claim-journey-0xa3147639ed3a03f68dab3f18cbb81d249c23ff6efb452f25b56c12ae8ba34a68.json` and `evidence/arc/paid-report-browser-downloads.json`.

The live owner and claimant use the same Privy account. Separate live actor isolation remains unproven. The local tests use separate actors. Budget allocation, live recovery, live model access, hosting, backups, and submission assets remain incomplete. The full goal remains active.

## Live allocation and post-payment transfer

The owner sets limits of one test USDC per allocation and one test USDC per UTC day. The owner deposits 1.5 test USDC, approves an exact policy, and enables the controller. Circle funds the approved bounty using a saved, fresh Graph observation. The approval becomes consumed.

Allocation transaction: `0x782193671c9e19d808fd0401997aef5a8e925b7c05ef5217da2441709d249e2f`. The capture script checks the canonical finalized block, exact `BudgetAllocated` and `BountyFunded` events, and exact USDC transfer. It also checks the immutable provider intent and source age at allocation.

The owner approves a second exact policy for one test USDC. The worker rejects it with `BUDGET_LIMIT`. It creates no transaction intent. A read-only call to the deployed controller at a finalized block returns `BudgetLimitReached`. The per-action limit permits the amount, and the minimum interval has elapsed. The daily limit rejects the call. No failing transaction is broadcast.

Evidence: `evidence/arc/budget-allocation-9c60762d-cd1d-4fad-ace3-b45f971d9c6e.json`. Graph supplies coverage context. This evidence does not prove a vault vulnerability.

After the qualifying payment, the claimant sends one test USDC to the organization wallet through Privy. Transaction: `0xfa7444fa2f6785c27d8c9a00623b3662d7b48511051b8eae34f59b1961367e5a`. The capture checks both final receipts, the paid claimant address, the transfer amount, and block order. It does not assign an identity to fungible token units. Evidence: `evidence/privy/outgoing-transfer-bd232fd2-fd37-442e-9a22-969d8fa7e35c.json`.

The owner evidence checks exact signed transaction fields, final events, and the restored current Privy base policy. Historical permission cleanup order also depends on the worker implementation and local tests. Evidence: `evidence/privy/owner-actions-0e36ddc6-5cfa-46cf-8c2f-6e9ad0d5fdb8.json`.

The owner returns the remaining 0.5 test USDC to the organization wallet. Withdrawal transaction: `0xe3e1930abfb2b1cc06d63cb3b39b7a402d9facaaec6fca25ca834f82c7df8003`. All six owner transactions have canonical finalized receipts. They cover all five command types. The current controller balance is zero. The controller remains enabled with its one-test-USDC daily limit.

Type checking and repository lint pass for all 170 source and configuration files in this evidence stage. The latest runtime suite remains 131 passing tests. The capture scripts also pass their live receipt checks.

## Bounty status and deadline controls

The draft list reads the confirmed bounty projection for both funding paths. It shows the current chain state and final funding receipt. A budget-funded draft no longer says that it has no funding request. An unfunded budget draft remains marked as awaiting allocation.

Owners can select a submission window, reservation length, and extra time before refund. Defaults remain three days, 30 minutes, and one hour. The API accepts a bounded grace period from zero to 86,400 seconds. The refund cutoff always includes at least one reservation length after submissions close. The exact approved policy preserves both deadlines.

The full suite passes 133 tests in 21 files. This includes draft status reads, current membership checks, default deadlines, a short cutoff, and invalid grace periods. Type checks, lint, and production builds pass. The live browser shows the budget-funded bounty as FUNDED and the settled bounty as PAID. It also creates and approves a short recovery draft. The refund itself remains under live verification.

`docs/MAINNET_READINESS.md` records the production gaps. Mainnet readiness remains NOT READY.

## Live automatic refund

The owner funds a short bounty with 0.25 test USDC. Its submission deadline is 13:40:45 UTC on 8 September 2026. Its refund cutoff is 13:41:45 UTC. The worker refunds the full amount after that cutoff. The final refund transaction is `0x3a3e9da124616ca88f3e13cc70f33ed8ca276282c1253629a5239218171e0c0e`.

The evidence capture verifies the original funding receipt, exact refund event, exact USDC transfer, fixed recipient, zero remaining liability, and completed recovery job. It finds one saved refund intent, one refund event, and one refund receipt. The signed-in browser shows REFUNDED and Recovery check complete. No claim is submitted to this bounty. This test therefore does not prove reservation expiry.

Circle uses an ERC-4337 smart account for the refund. The outer transaction comes from a relay and calls EntryPoint v0.6. The capture decodes its `handleOps` input, finds the configured Circle sender, checks the exact inner escrow call, recomputes the user-operation hash, and verifies the successful operation event. It does not mistake the relay sender for the Circle wallet. The interface follows [the EntryPoint definition](https://github.com/eth-infinitism/account-abstraction/blob/v0.6.0/contracts/interfaces/IEntryPoint.sol).

The worker records earlier retry states before the refund completes. Direct scan checks pass. The earlier errors have no detailed trace, so their exact cause remains unknown. New diagnostic logs record the failed stage and a fixed error category. They exclude provider error text, request contents, and stack traces. A local test inserts a private marker into a provider error and verifies that the log excludes it.

All 19 recovery tests pass after the diagnostic change. Type checks and repository lint pass. The most recent full runtime run, before this logging change, passes 133 tests. Evidence is in `evidence/arc/recovery-0xa26a9f3f8c56461e41ed35f85af089ef63617692a1e284abe60ad1953c813b87.json`. The live capture command is `pnpm exec tsx scripts/capture-recovery-evidence.ts <bountyId>`. It reads state and writes public evidence. It sends no transactions.

The three sponsor README files now map selected tracks to code, setup, evidence, feedback, and limits. Event rules are checked again on 8 September 2026. The live model, separate live accounts, hosting, staging backup and restore, receipt exports, remaining release commands, performance checks, public repository, and video remain open. The full submission goal remains active.


## Verified receipt exports

Owners and treasury members can filter receipts by category and recorded date. An export saves an immutable snapshot of at most 1,000 final receipts. The worker checks the canonical final transaction, event, amount, contract, block hash, and saved event fields before it creates CSV bytes. New receipts do not change an existing export.

The queue resumes pending exports. It limits failed checks to five attempts. Removed membership cancels pending work. Only the requester with a current owner or treasury role can read the saved export. The API and browser both check its SHA-256 file hash. The CSV keeps test-USDC base units as exact strings.

The live browser downloads seven organization receipts. The capture script checks the downloaded bytes against the saved snapshot and rechecks all seven final Arc events. Evidence: `evidence/arc/receipt-export-7e79696a-9135-41a3-818c-e73f0540f4ab.json`. This proves the local organization export with live testnet data. Researcher exports and hosted operation remain incomplete.

Seven new integration tests cover duplicate requests, immutable snapshots and files, current access, changed amounts and blocks, finality retries, filters, pagination, and the PostgreSQL job queue. All 141 TypeScript tests in 22 files pass. Type checking, lint, and the production build pass.


## Researcher payment records

The receipts page has separate organization and personal accounts. A researcher can list and export their own reward payments without organization membership. The export checks the saved claim owner and claimant address before it saves a snapshot. Organization funding and budget records do not appear in personal exports.

Two additional integration tests cover users without organization membership, duplicate export requests, other-user denial, separate export lists, immutable account scope, access after membership removal, and a mismatched claim owner. The tests use distinct local identities and a simulated chain provider. They do not prove access checks between separate live Privy accounts.

All 143 TypeScript tests in 22 files pass. Type checking, repository lint, and the production build pass. The current database has eighteen applied migrations.

The signed-in claimant downloads a personal export containing its one-test-USDC reward payment. The capture compares the downloaded file with the immutable snapshot and rechecks the final `Paid` event on Arc. Evidence: `evidence/arc/receipt-export-427fa358-8cab-424f-9ffb-b94c06d54c0c.json`. The same live account also owns the demo organization. Separate live-user checks remain pending.


## Separate deployment containers

The repository now builds service and web images from pinned Node.js and Caddy base images. The runtime image copies only application files. It excludes environment files, local keys, stored data, Git history, and evidence artifacts. Each service receives a separate environment file and only its required key mounts.

The container stack separates the API, worker, verifier, report service, retention process, database, and HTTPS gateway. Application containers use an unprivileged user, a read-only root filesystem, and no Linux capabilities. The gateway publishes the only host ports. The database has a private network. A separate migration command prepares its database before services start.

The live local container check uses a new database and empty storage. It includes no Circle session, Privy signing credential, or model key. The worker runs its configured Graph jobs. This check does not send wallet transactions. The existing demo remains on its original database and services.

The check verifies the local TLS certificate, expected public responses, denied unauthenticated report requests, blocked internal routes, and actual file access. It checks that the API cannot read verifier or report keys. It checks that the verifier cannot write evidence and that the report service cannot write report ciphertext. The retention container removes the temporary permission probes. It also checks rejection of local mode and local identity files before service startup.

Evidence is in `evidence/local/container-check.json`. The artifact records exact image hashes. These checks prove local container boundaries. Public hosting, separate database roles, live Linux Circle authentication, browser login through the deployed origin, backup and restore, and full staging acceptance remain incomplete.


## Release evidence index and live recheck

`evidence/live-manifest.json` indexes thirteen selected capture files. It records The Graph, Arc, and Privy as the three sponsors. It preserves `FIXTURE_ONLY`, `TRUSTED_SERVICE`, and the Arc Testnet asset. It lists the remaining submission requirements and records that the submission is incomplete.

The new `test:live` command requires explicit read-only testnet configuration. Its live run passes the escrow deployment and runtime-code checks, the fresh three-vault Graph query, and fifteen recorded event checks. The events cover financial receipts, the three-case claim journey, and the claimant's outgoing transfer. Evidence is in `evidence/live-read-checks.json`. This is a public data recheck. It does not repeat the private browser or wallet-provider flows.

The evidence validator checks paths, file hashes, and credential-like fields. Its file-only mode passes. Its default release check returns exit code 2 because acceptance mapping, required commands, model access, public deployment, and submission assets remain open. This result is expected. It must not be reported as submission readiness.

Three new unit tests reject changed event amounts, recipients, block references, missing and duplicate events, path escapes, symbolic-link escapes, and nested credentials. Type checking and repository lint pass.

The full local suite passes all 146 TypeScript tests in 23 files after the evidence command changes.


## Model credential boundary

The API can now enable the assistant with `ASSISTANT_ENABLED=true` and a public `MODEL_ID`. The model key remains in the worker environment. The enabled worker rejects a missing key. Both services reject an invalid enable flag. Existing local key-based configuration still works when the flag is absent.

Three configuration tests cover API-only setup, worker key requirements, explicit disablement, invalid configuration, and the existing local configuration. All ten assistant configuration and persistence tests pass. The browser reaches the OpenAI account settings. A funded model credential is still unavailable. Live model output and changed-source verification remain incomplete.

The full application suite passes after the model configuration change: 149 tests in 24 files. Type checks and lint also pass. This result does not establish live model access.
