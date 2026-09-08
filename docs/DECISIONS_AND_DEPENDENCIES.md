# Decisions and dependencies

Version: 1.0.0

## 1. Fixed decisions

| ID | Decision | Reason |
| --- | --- | --- |
| D-01 | Select The Graph, Arc, and Privy. | Cover data, settlement, and both financial users. |
| D-02 | Treat Hedera as an alternative only. | Avoid a fourth integration narrative. |
| D-03 | Use Arc testnet for settlement. | Match the selected settlement sponsor. |
| D-04 | Use a fixed, trusted fixture verifier in version 1. | Deliver a complete, honest reference product without an exploit execution service. |
| D-05 | Show `TRUSTED_SERVICE` as the verifier mode. | A service signature is not hardware attestation. |
| D-06 | Use one reward and one winning claim per bounty. | Make liabilities and claim admission explicit. |
| D-07 | Release reports after final payment, not merely qualification. | Match the user-facing payment promise. |
| D-08 | Keep all bounty funds idle in escrow. | Preserve payment liquidity. |
| D-09 | Let AI explain coverage and select preapproved funding actions only. | Keep financial authority and claim correctness outside model output. |
| D-10 | Keep source vault data and settlement data separate. | The Graph need not index Arc for the project to use live Graph data. |
| D-11 | Use separate Privy user wallets and a Circle operations wallet. | Avoid uncertain wallet interoperability. |
| D-12 | Use generally available wallet transfers and controls. | Avoid required flows that depend on commercial onboarding. |
| D-13 | Treat Classic entry status as an assumption. | Actual prior work and organizer rules determine eligibility. |

## 2. External dependencies

| Dependency | Required input | Local work possible without it | Live completion condition |
| --- | --- | --- | --- |
| Privy | App ID, server credentials, approved authentication methods | UI and provider adapters with labelled test doubles | Real sign-in, wallets, allowed action, blocked action, and transfer |
| The Graph | Provider endpoint and access key; deployed package ID | Schema, mapping tests, query client | Live multi-vault query with source metadata |
| Arc | RPC access, token configuration, testnet gas, deployer | Local contracts and integration tests | Verified chain ID, funded deployment, final receipts |
| Circle | Agent Stack account/session and wallet access | Budget policy engine and adapter tests | Real Circle wallet contract action on Arc |
| Model provider | Approved model ID and API key | Deterministic recommendation engine | Model response grounded in actual Graph records |
| Hosting | Approved host, TLS origin, database, object storage | Container setup and local stack | Isolated services and real deployment URLs |
| Verifier keys | Dedicated signing and encryption keys | Development keys created outside version control | Service keys isolated from application credentials |
| Organization report key | Key registered before funding | Test key fixture | Authenticated organization setup and working decryption |

List these values in `.env.example` during implementation. Use placeholders only. Never place real credentials in this document, screenshots, or the repository.

## 3. Facts to verify during preflight

1. Verify current Arc RPC, chain ID, USDC ERC-20 interface, decimals, and gas behavior from official documentation and RPC reads.
2. Verify the exact Privy policy operations supported for the configured Arc wallet path.
3. Verify that Circle Agent Stack can submit the required budget-controller transaction through a documented wallet interface.
4. Verify The Graph provider coverage for the selected source networks. Deploy live demo source fixtures only on a supported network.
5. Verify source vault addresses and their asset metadata. Do not invent addresses.
6. Verify provider terms, account limits, and available testnet balances before enabling automated spending.
7. Verify Classic eligibility, cumulative track awards, and unspecified prize distributions with the organizers or sponsors.

Questions 1-6 are integration checks. If a capability is unavailable, report the exact failed check. Do not replace a live requirement with a mock and mark it complete.

## 4. Defaults the build agent may choose

The build agent may choose exact compatible package versions, local ports, UI component details, database index names, and internal file organization. Record package versions and deployment addresses in generated manifests.

The agent may not change the sponsor set, add a token, add a new financial product, alter the verification trust model, or add third-party execution capabilities without a new user decision.

## 5. Source ledger

Checked on 8 September 2026. These sources are time-sensitive.

- [ETHGlobal submission and track rules](https://ethglobal.com/events/ethonline2026/info/details)
- [The Graph prizes](https://ethglobal.com/events/ethonline2026/prizes/the-graph)
- [Arc prizes](https://ethglobal.com/events/ethonline2026/prizes/arc)
- [Privy prizes](https://ethglobal.com/events/ethonline2026/prizes/privy)
- [Arc network configuration](https://docs.arc.io/arc/references/connect-to-arc)
- [Privy policies](https://docs.privy.io/controls/policies/overview)
- [Privy EVM configuration](https://docs.privy.io/basics/react/advanced/configuring-evm-networks)
- [Circle Agent Stack](https://developers.circle.com/agent-stack)

The user-supplied prize text is the reference for the full track wording. Do not copy marketing claims from that text into product guarantees.
