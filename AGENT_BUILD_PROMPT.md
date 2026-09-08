# VulnProof implementation prompt

Build VulnProof from the specification package in this repository. Deliver a working application, contracts, live provider integrations where credentials and authorization are available, tests, and reproducible deployment instructions.

## Read before editing

Read these files in order:

1. `README.md`
2. `docs/PRD.md`
3. `docs/TECHNICAL_SPEC.md`
4. `docs/DATA_AND_API.md`
5. `docs/ACCEPTANCE_TESTS.md`
6. `docs/SPONSOR_REQUIREMENTS.md`
7. `docs/DECISIONS_AND_DEPENDENCIES.md`
8. `docs/BUILD_PLAN.md`

Inspect any applicable `AGENTS.md` instructions and existing workspace changes. Preserve the user’s work. The current specification package contains documentation only. Do not assume application files or commands already exist.

## Product to build

Use The Graph, Arc, and Privy as the three selected sponsors. The product serves protocol teams that fund fixed bounties and researchers who submit private claims and receive payments.

The Graph supplies live standardized vault coverage data. A coverage assistant explains funding gaps with source references. Privy supplies organization and researcher wallets with a real funding control. Arc holds fixed bounty rewards. Circle Agent Stack funds preapproved bounties through the limited budget controller.

The reference verifier checks fixed synthetic accounting records from team-created fixtures. It does not execute arbitrary code, reproduce exploits, discover vulnerabilities, or test third-party contracts. Public vault data is read-only coverage context. Do not build a general vulnerability scanner or transaction replay service.

Show `FIXTURE_ONLY` evidence scope and `TRUSTED_SERVICE` verifier mode. The operator can access evidence. Do not claim zero-knowledge proof, hardware attestation, or proof of a live vault vulnerability.

## Required behavior

- Create and fund immutable, one-reward bounties.
- Reserve one reward for one eligible claim at a time.
- Verify only the fixed evidence format.
- Derive the report from the assessed record.
- Credit a qualifying reward once and preserve collection without sponsor approval.
- Release the organization report only after final payment.
- Handle rejection, expiry, retries, timeouts, and recovery accurately.
- Complete an outgoing researcher wallet transfer with user authorization.
- Produce separate evidence for all seven selected prize tracks.

## Work method

Start with the foundation, shared schemas, canonical encodings, and financial contracts. Follow the work-package dependencies in the build plan. Complete the local qualifying and control journeys before expanding visual features.

Use short progress updates that report completed work, new findings, and remaining blockers. Keep implementation status current. Make routine implementation choices yourself. Ask only when a missing input prevents dependent work or a material product decision is required. Continue independent work while an external dependency is unavailable.

If the user explicitly authorizes parallel agents, assign separate work packages and define file ownership. Do not let separate agents invent competing schemas or financial rules. Otherwise, implement without spawning agents.

Use current official SDK documentation. Lock compatible package versions. Do not invent provider APIs, deployment addresses, test results, transaction hashes, or credentials.

## Financial and privacy rules

Use integer base units. Keep Arc native gas units separate from the USDC ERC-20 interface. Show one underlying USDC balance. Do not add yield, borrowing, tokenized claims, swaps, or unrelated payment features.

The language model may explain coverage. It may not determine claim validity, change payout rules, access evidence, or authorize arbitrary transactions. The operations agent can select only exact, approved policies. The budget controller must enforce cumulative limits onchain.

Keep ciphertext storage and key access separate from the public API. Keep evidence and report plaintext out of logs, prompts, analytics, and public artifacts. Use maintained cryptographic libraries. Do not create custom cryptographic primitives.

## External actions

This prompt authorizes implementation in the workspace and local verification. Use live testnet providers only within the user’s configured and authorized account scope. Do not purchase resources, spend mainnet funds, send external messages, publish secrets, or submit the hackathon entry without explicit authorization.

Missing live credentials are a blocker for the affected live gate. They are not a reason to fake provider success. Provide `.env.example`, preflight checks, and exact setup instructions. Continue local implementation where possible.

## Completion standard

Run the relevant acceptance tests and fix observed failures. Include contract invariant tests, provider integration checks, browser journeys, logging checks, and the live evidence manifest. Do not write tests that merely repeat implementation logic.

Every reported success must have evidence. Mark tests as `PASS`, `FAIL`, or `BLOCKED`. Keep local and live results distinct. If the specification has a contradiction, record and resolve it before implementing the affected behavior.

Return the application start instructions, deployment details, tested commit, test summary, sponsor evidence links, and remaining blockers. Do not stop after scaffolding, a static mockup, or a plan.

## Communication

Apply ASD-STE100 Simplified Technical English to user-visible text and documentation. Use short, direct sentences and consistent terms. Preserve exact code identifiers and required third-party terminology.
