# VulnProof build specification

Version: 1.0.0  
Created: 8 September 2026  
Status: Ready for implementation of the defined testnet reference product. No application code exists yet.

VulnProof lets a protocol team fund a fixed bounty, receive a confidential claim assessment, pay a qualifying researcher, and receive the corresponding report after payment.

Selected sponsors: **The Graph, Arc, and Privy**. Hedera is the first alternative. A change to the selected sponsors requires a new product decision.

## Read first

The product scope has an explicit verification limit. Version 1 uses controlled accounting fixtures. These fixtures contain known test records created by the team. A trusted verifier checks those records against a fixed condition. It does not discover vulnerabilities, reproduce exploits, execute arbitrary transactions, or establish that a third-party vault is vulnerable.

This is a working confidential claim-and-payment reference product. It is not a general proof-of-vulnerability engine. The verifier operator can access submitted evidence in version 1. Encryption protects the evidence in transport and storage, and access controls withhold it from the protocol team until payment. Do not describe this as zero-knowledge verification or hardware-attested execution.

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

## Start the build

Give the next build agent [AGENT_BUILD_PROMPT.md](AGENT_BUILD_PROMPT.md). Ask it to build the version 1 product in this repository. The agent must read the complete package first.

The specification defines local and testnet work. Creating this package does not deploy contracts, open provider accounts, spend funds, contact sponsors, or submit a hackathon entry. Mainnet release requires the separate readiness work in the build plan.

## Working assumptions

- The entry uses the Classic / From Scratch track. Confirm actual eligibility before submission.
- The team can assign separate owners to the independent work packages.
- The team supplies provider accounts, testnet balances, and an approved deployment environment.
- All live integrations require real responses and transaction evidence. Local substitutes must have visible labels.
- Award amounts and SDK support can change. Recheck the primary sources before submission.

## Writing rule

Apply ASD-STE100 Simplified Technical English to user-visible text and documentation. Write short sentences. Use consistent terms. Preserve exact API names, code identifiers, and third-party terminology when required.
