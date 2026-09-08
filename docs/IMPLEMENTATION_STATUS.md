# Implementation status

Updated: 8 September 2026

The full submission objective remains active. Live Graph indexing and the initial Arc deployment checks pass. Full user journeys remain incomplete.

| Package | Status | Evidence |
| --- | --- | --- |
| WP-01 Foundation | IN_PROGRESS | Workspace, local infrastructure, and provider preflight created. Type check passes. |
| WP-02 Domain and database | IN_PROGRESS | Strict schemas, policy hashing, 27 database tables, and two applied migrations. OpenAPI generation pending. |
| WP-03 Escrow | IN_PROGRESS | Contract implemented. Financial suite: 17 passing tests, including 256-run fuzz cases. Arc Testnet deployment verified. API integration pending. |
| WP-04 Budget controller | IN_PROGRESS | Exact policy approval and cumulative limits implemented and tested locally. Live Circle path pending. |
| WP-05 Identity and Privy | IN_PROGRESS | VulnProof development app created. Live login UI opens. Server token verification, roles, and transactional retries implemented. Wallet policies and transfers pending. |
| WP-06 Graph data | IN_PROGRESS | One shared schema indexes three live vaults. The Studio query returns fresh observations without indexing errors. |
| WP-07 Coverage intelligence | IN_PROGRESS | Deterministic coverage calculations, source checks, and exact approved policy selection pass tests. Database updates and model explanations are pending. |
| WP-08 Confidential service | IN_PROGRESS | Fixed fixture assessment, atomic encrypted file storage, service tokens, and payment-gated report access implemented. Separate service deployment pending. |
| WP-09 Settlement worker | NOT_STARTED | No evidence yet |
| WP-10 Circle agent | IN_PROGRESS | Circle CLI 1.0.0 is authenticated. The agent wallet received test USDC and deployed the escrow. Bounded funding remains pending. |
| WP-11 Application | IN_PROGRESS | Responsive workspace, live Privy login UI, organization creation, program creation, and database views. Financial actions pending. |
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

- Pass 32 TypeScript tests. These tests include real PostgreSQL transactions, concurrent retries, current role checks, encrypted storage integrity, and exact payment gating.
- Pass 17 Solidity tests from the contract stage.
- Pass TypeScript type checking.
- Pass the first production frontend build. Rebuild after later changes.
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
