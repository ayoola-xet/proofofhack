# VulnProof

Version: 1.0.0  
Created: 8 September 2026  
Status: Implementation in progress. Live Graph coverage and a Privy transfer on Arc pass checks. The full claim and settlement flow remains incomplete.

VulnProof lets a protocol team fund a fixed bounty, receive a confidential claim assessment, pay a qualifying researcher, and receive the corresponding report after payment.

Selected sponsors: **The Graph, Arc, and Privy**. Hedera is the first alternative. A change to the selected sponsors requires a new product decision.

## Read first

The product scope has an explicit verification limit. Version 1 uses controlled accounting fixtures. These fixtures contain known test records created by the team. A trusted verifier checks those records against a fixed condition. It does not discover vulnerabilities, reproduce exploits, execute arbitrary transactions, or establish that a third-party vault is vulnerable.

The product is a confidential claim-and-payment reference implementation. It is not a general proof-of-vulnerability engine. The verifier operator can access submitted evidence in version 1. Encryption protects the evidence in transport and storage, and access controls withhold it from the protocol team until payment. Do not describe this as zero-knowledge verification or hardware-attested execution.

The product can retain the VulnProof name. Show the verification mode and fixture limitation in the claim flow and demo. A later provider can add hardware-attested execution through the defined verifier interface. That work requires a separate specification and validation.

## Document map

| File | Purpose |
| --- | --- |
| [PRD](docs/PRD.md) | Users, scope, journeys, screens, requirements, and success measures |
| [Technical specification](docs/TECHNICAL_SPEC.md) | Architecture, contract rules, verification, privacy, integrations, and operations |
| [Data and API specification](docs/DATA_AND_API.md) | Data model, API behavior, event formats, and external service boundaries |
| [Acceptance tests](docs/ACCEPTANCE_TESTS.md) | Required test scenarios and release evidence |
| [Build plan](docs/BUILD_PLAN.md) | Dependency order, work packages, integration gates, and completion rules |
| [Sponsor requirements](docs/SPONSOR_REQUIREMENTS.md) | Seven target tracks, evidence, and qualification limits |
| [Decisions and dependencies](docs/DECISIONS_AND_DEPENDENCIES.md) | Fixed decisions, unresolved external facts, and account setup |
| [Agent build prompt](AGENT_BUILD_PROMPT.md) | Instructions to start the implementation from an empty repository |

## Document authority

Use the user's latest explicit decisions first. Use the PRD for product scope. Use the technical specification for trust and financial rules. Use the data specification for wire formats. Use the acceptance tests to determine completion.

If documents conflict, record the conflict and resolve it before implementing the affected behavior. Never remove a financial or privacy rule to make a test pass. The older strategy PDF supplies context only. This package replaces its sponsor plan, implementation plan, verifier scope, and settlement design.

## Run the current implementation

1. Install the locked dependencies with `pnpm install --frozen-lockfile`.
2. Copy `.env.example` to `.env`. Add the Privy and Graph configuration.
3. Start PostgreSQL with `docker compose up -d`.
4. Apply database migrations with `pnpm db:migrate`.
5. Check that the configured deployment has its matching service keys. For a new environment, run `pnpm setup:keys` and `pnpm exec tsx scripts/setup-researcher-report-key.ts` before deployment.
6. Start report release with `pnpm dev:reports`.
7. Start the verifier with `pnpm dev:verifier`.
8. Start the API with `pnpm dev:api`.
9. Start the worker with `pnpm dev:worker`.
10. Start the web app with `pnpm dev:web`.
11. Start ciphertext cleanup with `pnpm dev:retention` after all services run the current source version.
12. Open `http://127.0.0.1:5173` and sign in.

Use a separate terminal for each service. Run `pnpm typecheck`, `pnpm test`, and `pnpm test:contracts` to check the implementation. PostgreSQL must run for the integration tests. Run `pnpm build` to build the frontend and Graph package.

Read [implementation status](docs/IMPLEMENTATION_STATUS.md) for completed work and remaining release requirements. Public integration evidence is in `evidence/`. Configuration secrets stay in the ignored `.env` file.

Read [retention and recovery](docs/RETENTION_AND_RECOVERY.md) before restoring data. Use `pnpm retention:run` for one cleanup scan. Hosted backups and financial recovery remain release requirements.

## Working assumptions

- The entry uses the Classic / From Scratch track. Confirm actual eligibility before submission.
- The team can assign separate owners to the independent work packages.
- The team supplies provider accounts, testnet balances, and an approved deployment environment.
- All live integrations require real responses and transaction evidence. Local substitutes must have visible labels.
- Award amounts and SDK support can change. Recheck the primary sources before submission.

## Writing rule

Apply ASD-STE100 Simplified Technical English to user-visible text and documentation. Write short sentences. Use consistent terms. Preserve exact API names, code identifiers, and third-party terminology when required.
