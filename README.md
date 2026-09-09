# ProofOfHack

Version: 1.0.0  
Created: 8 September 2026  
Status: Implementation in progress. Live Graph coverage and a Privy transfer on Arc pass checks. The full claim and settlement flow remains incomplete.

ProofOfHack lets a protocol team fund a fixed bounty, receive a confidential claim assessment, pay a qualifying researcher, and receive the corresponding report after payment.

Selected sponsors: **The Graph, Arc, and Privy**. Hedera is the first alternative. A change to the selected sponsors requires a new product decision.

## Read first

The product scope has an explicit verification limit. Version 1 uses controlled accounting fixtures. These fixtures contain known test records created by the team. A trusted verifier checks those records against a fixed condition. It does not discover vulnerabilities, reproduce exploits, execute arbitrary transactions, or establish that a third-party vault is vulnerable.

The product is a confidential claim-and-payment reference implementation. It is not a general proof-of-vulnerability engine. The verifier operator can access submitted evidence in version 1. Encryption protects the evidence in transport and storage, and access controls withhold it from the protocol team until payment. Do not describe this as zero-knowledge verification or hardware-attested execution.

Use the ProofOfHack name. Show the verification mode and fixture limitation in the claim flow and demo. A later provider can add hardware-attested execution through the defined verifier interface. That work requires a separate specification and validation.

## Run the current implementation

1. Use Node.js 24.16.0 and pnpm 10.32.1. The Node version is in `.nvmrc`.
2. Install the locked dependencies with `pnpm install --frozen-lockfile`.
3. Install Foundry v1.5.0 for the local contract tools.
4. Copy `.env.example` to `.env`. Complete the provider, deployment, and service configuration.
5. Start PostgreSQL with `docker compose --project-name proofofhack -f infra/compose.yaml up -d --wait`.
6. Apply database migrations with `pnpm db:migrate`.
7. Check that the configured deployment has its matching service keys. For a new environment, run `pnpm setup:keys` and `pnpm exec tsx scripts/setup-researcher-report-key.ts` before deployment. Keep the existing keys for an existing deployment.
8. Run `pnpm dev --check` to check required settings and available ports.
9. Run `pnpm dev` to start report release, the verifier, the API, the worker, ciphertext cleanup, and the web app.
10. Open `http://127.0.0.1:5173` and sign in.

Keep the start command running. Press Ctrl+C to stop its service group. The command stops the group if one service exits. It rejects ports already used by another process. Provider checks run inside each service. A ready web port alone does not prove provider access. The command starts the configured app. It requires the existing provider accounts and deployment.

The individual `dev:*` commands remain available for service debugging. Use them in separate terminals. Start either the service group or individual services for the same ports.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm test:contracts` to check the implementation. PostgreSQL must run for integration tests. Run `pnpm test:unit` for tests that do not require PostgreSQL. Run `pnpm test:integration` for tests that use PostgreSQL. The full test command builds contract artifacts first. Run `pnpm build` to build the frontend and Graph package.

Public integration evidence is in `evidence/`. Configuration secrets stay in the ignored `.env` file. Use `pnpm retention:run` for one cleanup scan. Hosted backups and financial recovery remain release requirements.

## Working assumptions

- The entry uses the Classic / From Scratch track. Confirm actual eligibility before submission.
- The team can assign separate owners to the independent work packages.
- The team supplies provider accounts, testnet balances, and an approved deployment environment.
- All live integrations require real responses and transaction evidence. Local substitutes must have visible labels.
- Award amounts and SDK support can change. Recheck the primary sources before submission.

## Writing rule

Apply ASD-STE100 Simplified Technical English to user-visible text and documentation. Write short sentences. Use consistent terms. Preserve exact API names, code identifiers, and third-party terminology when required.

## Deployment containers

Use the container files in `infra/` to build and check separate API, worker, verifier, report, retention, database, and HTTPS gateway containers. The local container check uses a separate database. Public hosting and the complete staging acceptance scenario remain required.
