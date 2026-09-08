# Implementation status

Updated: 8 September 2026

The full submission objective remains active. Live Graph indexing and the initial Arc deployment checks pass. Full user journeys remain incomplete.

| Package | Status | Evidence |
| --- | --- | --- |
| WP-01 Foundation | IN_PROGRESS | Workspace, local infrastructure, and provider preflight created. Type check passes. |
| WP-02 Domain and database | IN_PROGRESS | Strict schemas, policy hashing, 32 database tables, and ten applied migrations. OpenAPI generation pending. |
| WP-03 Escrow | IN_PROGRESS | Contract implemented. Financial suite: 17 passing tests, including 256-run fuzz cases. Arc Testnet deployment verified. Draft approval and durable funding are connected through the API and worker. Database and failure-path tests pass. The live bounty funding test remains pending. |
| WP-04 Budget controller | IN_PROGRESS | Exact policy approval and cumulative limits implemented and tested locally. Live Circle path pending. |
| WP-05 Identity and Privy | IN_PROGRESS | Live login, current role checks, and user wallet transfers work. The organization wallet has a verified Privy owner and policy. Live signing checks accept an allowed approval and reject an unapproved spender. Bounty funding remains pending. |
| WP-06 Graph data | IN_PROGRESS | One shared schema indexes three live vaults. The Studio query returns fresh observations without indexing errors. |
| WP-07 Coverage intelligence | IN_PROGRESS | Deterministic coverage calculations, source checks, and exact approved policy selection pass tests. Durable database updates and rule-based explanations work. The model adapter, saved requests, current-source checks, and source validation pass local tests. Live model verification needs credentials. |
| WP-08 Confidential service | IN_PROGRESS | Fixed fixture assessment, atomic encrypted file storage, service tokens, and payment-gated report access implemented. The report service runs separately on port 4190 and creates organization keys. Encrypted fixture admission, signed assessment, and separate report download services pass a full local chain test. Live operation remains pending. |
| WP-09 Settlement worker | IN_PROGRESS | Funding confirms the canonical Arc receipt and exact approval, funding, and USDC transfer events. It saves signed bytes before broadcast and resumes the same intent after a lost response. The claim settlement core passes a local chain test. The queue and Circle execution connection are configured. Local tests also reconcile a payment collected outside the worker. The live claim test remains pending. |
| WP-10 Circle agent | IN_PROGRESS | Circle CLI 1.0.0 is authenticated. The agent wallet received test USDC and deployed the escrow. Bounded funding remains pending. |
| WP-11 Application | IN_PROGRESS | Responsive workspace, live Privy login, organization and program setup, vault coverage, and wallet transfers work. The new bounty page prepares signed fixtures, downloads cases, approves terms, and requests Privy funding confirmation. Its live browser test waits for the Mac to be unlocked. |
| WP-12 Deployment and evidence | NOT_STARTED | No evidence yet |

## Environment

Node 24.16.0, Docker 28.3.3, and Foundry 1.3.5-foundry-zksync-v0.1.9 are available. The repository started without Git history. The approved specification is preserved in its first commit.

## Stack decision

Keep the user-approved React/Vite, Fastify, and PostgreSQL architecture. A single hosted-site starter cannot replace the separately isolated verifier and report services. No Sites scaffold or hosted resources have been created.

## Dependency versions

Solidity 0.8.30, OpenZeppelin Contracts 5.6.1, viem 2.56.3, Zod 4.5.4, TypeScript 7.0.2, Vitest 5.0.0, and libsodium-wrappers-sumo 0.8.4 are locked.

## Open input

Privy app configuration is stored in the ignored .env file with mode 0600. Graph email verification and Circle testnet sign-in are complete. Model access and hosting still need setup. No secrets are stored in Git.

## Current verification

- Pass the 56-test TypeScript suite and two added Arc finality tests. These tests include real PostgreSQL transactions, concurrent retries, current role checks, encrypted storage integrity, and exact payment gating.
- Pass 17 Solidity tests from the contract stage.
- Pass TypeScript type checking.
- Pass the production frontend build after the organization wallet changes. Vite reports one large dependency chunk.
- Pass lint checks for all 14 files changed in the wallet stage. Repository-wide lint still reports 13 existing errors and 23 warnings in other files. Resolve these before submission.
- Open the live Privy login window through the new app. The user has signed in to the local workspace. Financial user journeys remain pending.
- Check the desktop landing page and the 390-pixel mobile page. Mobile scroll width equals viewport width. Browser evidence is in the ignored output/playwright folder.

## Local services

The frontend runs at http://127.0.0.1:5173. The API uses port 4187. Another existing Docker service uses port 4100, so that service remains unchanged. PostgreSQL uses port 5433.

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
