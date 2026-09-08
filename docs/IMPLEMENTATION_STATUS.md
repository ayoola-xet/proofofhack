# Implementation status

Updated: 8 September 2026

The full submission objective remains active. Live Graph indexing and the initial Arc deployment checks pass. Full user journeys remain incomplete.

| Package | Status | Evidence |
| --- | --- | --- |
| WP-01 Foundation | IN_PROGRESS | Workspace, local infrastructure, and provider preflight created. Type check passes. |
| WP-02 Domain and database | IN_PROGRESS | Strict schemas, policy hashing, 29 database tables, and six applied migrations. OpenAPI generation pending. |
| WP-03 Escrow | IN_PROGRESS | Contract implemented. Financial suite: 17 passing tests, including 256-run fuzz cases. Arc Testnet deployment verified. Signed fixture manifests and owner-approved bounty drafts are available through the API. Funding integration remains pending. |
| WP-04 Budget controller | IN_PROGRESS | Exact policy approval and cumulative limits implemented and tested locally. Live Circle path pending. |
| WP-05 Identity and Privy | IN_PROGRESS | Live login, current role checks, and user wallet transfers work. The organization wallet has a verified Privy owner and policy. Live signing checks accept an allowed approval and reject an unapproved spender. Bounty funding remains pending. |
| WP-06 Graph data | IN_PROGRESS | One shared schema indexes three live vaults. The Studio query returns fresh observations without indexing errors. |
| WP-07 Coverage intelligence | IN_PROGRESS | Deterministic coverage calculations, source checks, and exact approved policy selection pass tests. Durable database updates and rule-based explanations work. Model explanations are pending. |
| WP-08 Confidential service | IN_PROGRESS | Fixed fixture assessment, atomic encrypted file storage, service tokens, and payment-gated report access implemented. The report service runs separately on port 4190 and creates organization keys. Evidence verification and plaintext report delivery are not connected yet. |
| WP-09 Settlement worker | NOT_STARTED | No evidence yet |
| WP-10 Circle agent | IN_PROGRESS | Circle CLI 1.0.0 is authenticated. The agent wallet received test USDC and deployed the escrow. Bounded funding remains pending. |
| WP-11 Application | IN_PROGRESS | Responsive workspace, live Privy login UI, organization creation, program creation, and database views. Vault registration, coverage policy approval, and live source decisions work. Financial actions pending. |
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

- Pass 49 TypeScript tests and three added signing-response tests. These tests include real PostgreSQL transactions, concurrent retries, current role checks, encrypted storage integrity, and exact payment gating.
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

Direct Privy broadcast returns an Arc chain authorization error for this app. The integration uses `eth_signTransaction` with the same restrictions. The signer and every transaction field are checked before a signed transaction can enter the broadcast workflow. This approach follows the [Privy transaction signing interface](https://docs.privy.io/wallets/using-wallets/ethereum/sign-a-transaction). The broadcast workflow still needs integration.

Live evidence is in `evidence/privy/treasury-signing-policy-92a15f31-8003-4cfd-a30a-103eb855fe6d.json` and `evidence/privy/treasury-allowed-signing-92a15f31-8003-4cfd-a30a-103eb855fe6d.json`. Privy rejects a zero-amount approval to an unapproved spender with `policy_violation`. Privy signs a zero-amount approval to the approved escrow. Neither check broadcasts a transaction. These checks do not prove bounty funding or nested funding-field enforcement.
