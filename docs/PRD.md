# Product requirements document

Version: 1.0.0  
Product: VulnProof  
Release: ETHOnline testnet reference product

## 1. Product decision

Build a bounty operation for protocol teams and researchers. Combine funded payment promises, controlled claim assessment, private report delivery, and clear financial records.

Use The Graph for live coverage data. Use Arc for USDC settlement and a controlled funding agent. Use Privy for organization and researcher wallets.

The first release demonstrates the complete operation with team-owned accounting fixtures. It does not claim to verify arbitrary vulnerabilities. This scope is a deliberate limit, not a hidden substitute for live proof.

## 2. Problem

A researcher can lose control of a finding before payment is certain. A protocol team also needs useful evidence before it pays. Both parties need a fixed statement of what qualifies, what gets paid, and what gets delivered.

Protocol teams have a second problem. Their vault inventory, bounty coverage, funding decisions, and payment records can sit in separate tools. VulnProof connects those tasks.

## 3. Users

| User | Need | Successful result |
| --- | --- | --- |
| Organization owner | Set team access and funding limits | A controlled organization account |
| Treasury manager | Fund approved programs and reconcile spending | Correct balances and payment receipts |
| Security reviewer | Define scope and receive paid reports | A report linked to a qualifying assessment |
| Researcher | Submit a private claim and collect payment | A confirmed payment before protocol disclosure |
| Judge or evaluator | Verify the live product behavior | Reproducible evidence for each integration |

An organization is the protocol team using the product. Use “organization” in data and API names. Use “protocol team” when it is clearer in the interface.

## 4. Product promise and limits

For an eligible, reserved claim, the verifier checks the fixed policy. The escrow credits a qualifying payment to the claimant. The claimant can collect that credit without sponsor approval. The system releases the report to the protocol team only after the payment is final under the configured chain policy.

Reservation is required. A funded bounty supports one qualifying payment in version 1. Only one claim can hold the active reservation. Waiting claims do not have guaranteed funds. Show this before submission.

The trusted verifier operator can access the evidence. The organization cannot access it before payment. Show this distinction before a researcher uploads evidence.

The word “guaranteed” is not permitted in an unqualified marketing statement. Use “Funds reserved,” “Payment available,” and “Payment confirmed” for the exact states.

## 5. Outcomes

| ID | Required outcome |
| --- | --- |
| O-01 | A protocol team funds a fixed USDC bounty through a real Privy wallet on Arc testnet. |
| O-02 | A Privy control rejects at least one prohibited funding action. |
| O-03 | The Graph supplies live standardized data for at least three independently identified vault deployments. |
| O-04 | The coverage assistant gives a cited recommendation that changes when the source data changes. |
| O-05 | A Circle Agent Stack wallet funds an approved policy through the limited budget controller. |
| O-06 | A qualifying fixture claim produces one real payment and one private report release. |
| O-07 | A nonqualifying fixture claim produces no payment and no organization report access. |
| O-08 | A researcher completes a real outgoing wallet transfer after receiving payment. |
| O-09 | Every financial status can be traced to a confirmed transaction or an explicitly pending request. |

## 6. Included scope

- Organizations, role-based access, and Privy authentication.
- A read-only vault inventory built from live Graph provider data.
- Reusable ERC-4626 coverage data schema and query examples.
- A source-aware coverage assistant for registered vaults.
- Privy organization wallets and researcher wallets.
- Approved policy templates and bounded funding automation.
- Fixed-price bounties with one reward each.
- Encrypted fixture evidence submission and a fixed verification service.
- Reservation, qualification, payment collection, timeout, and refund behavior.
- Report release after confirmed payment.
- Organization receipts, researcher receipts, and CSV export.
- Provider status, transaction recovery, and a truthful demo mode.

## 7. Excluded scope

- Vulnerability scanning, exploit generation, arbitrary EVM replay, or execution against third-party targets.
- Automated severity decisions by a language model.
- General security ratings for public vaults.
- Zero-knowledge proofs or hardware attestation in the baseline release.
- Duplicate-finding arbitration across different researchers or real findings.
- Multiple winning claims under one bounty.
- Yield on reserved funds, loans, tokenized claims, swaps, cards, or cross-chain transfers.
- Mainnet funds in the reference deployment.
- Automatic public disclosure or messages to external parties.
- Hedera or Chainlink integration in the selected sponsor implementation.

## 8. Vocabulary

| Term | Meaning |
| --- | --- |
| Program | An organization’s set of related bounties and coverage settings |
| Bounty | One immutable policy and one fixed USDC reward |
| Policy | The target, allowed evidence, verification condition, reward, and deadlines |
| Fixture | A team-created test record used to demonstrate a known condition |
| Claim | A researcher submission for one bounty |
| Reservation | A temporary, exclusive hold on that bounty’s reward for one claim |
| Qualification | A signed verifier result accepted by the escrow contract |
| Credit | The amount the claimant can collect from the escrow |
| Report | The verified fixture record and explanation released after payment |
| Coverage | The relation between a registered vault and a funded bounty program |

Coverage does not mean that a vault is secure or insured.

## 9. Main journeys

### J-01. Create and fund a program

1. Sign in with Privy.
2. Create an organization and select its members.
3. Connect a source vault from the live inventory.
4. Select an approved fixture policy for the reference demo.
5. Review the reward, deadline, verifier trust, and report recipient.
6. Approve the Privy funding request.
7. Wait for the Arc transaction to become final.
8. View the funded bounty and its receipt.

Do not show “Funded” when the user only signs or broadcasts a transaction.

### J-02. Review coverage

1. Open the coverage view.
2. Ask which registered vaults lack funded coverage.
3. Review the recommendation, source block, data time, and policy calculation.
4. Select an already approved policy or request human review of a new policy.
5. View the resulting funding action or recommendation status.

The assistant cannot infer vulnerabilities from the data. It must describe funding and inventory conditions only.

### J-03. Use bounded funding automation

1. Approve exact policy hashes and fund a separate operations budget.
2. Set a daily limit, per-policy limit, and minimum action interval.
3. Enable the Circle operations agent.
4. Let the agent select an eligible approved policy from fresh coverage data.
5. Confirm that the budget controller enforces the limits onchain.
6. View the transaction and remaining budget.

An owner can disable new allocations. Disabling allocations must not remove an existing claimant’s credit.

### J-04. Submit a claim

1. Sign in and select a fixture bounty.
2. Read the trust notice and reservation rule.
3. Select a team-provided evidence package.
4. Encrypt the package in the browser.
5. Upload the ciphertext.
6. Request claim admission and view the reservation transaction.
7. Wait for assessment.
8. Collect the credited payment when the claim qualifies.

An encrypted upload is not a reserved claim. Show “Waiting for reservation” until the chain confirms the hold.

### J-05. Deliver the report

1. Observe final payment to the claimant’s bound address.
2. Make the corresponding encrypted report available to authorized organization reviewers.
3. Let the reviewer open the report in the authenticated application.
4. Record successful delivery and access without recording report contents.

The researcher can retrieve their own report before payment. The protocol team cannot.

### J-06. Recover from failure

Show a clear action for a failed upload, rejected wallet action, expired reservation, failed verifier job, failed transaction, or delayed report. Preserve claim identifiers across retries. A service failure must not appear as a nonqualifying result.

## 10. Functional requirements

| ID | Requirement | Acceptance |
| --- | --- | --- |
| FR-01 | Authenticate each user and bind owned wallets with Privy. | A client cannot set another user’s identity or wallet. |
| FR-02 | Enforce organization roles on the server. | A researcher cannot read another organization’s private data. |
| FR-03 | Read live vault data through The Graph. | The UI shows provider, source block, and freshness. |
| FR-04 | Publish a reusable coverage schema. | One query shape works across the configured vaults. |
| FR-05 | Explain coverage decisions with sources. | Unsupported answers abstain. |
| FR-06 | Create a bounty with immutable policy and exact funding. | Funding fails atomically if the token transfer fails. |
| FR-07 | Enforce wallet and budget controls. | A prohibited request fails at the provider or contract boundary. |
| FR-08 | Allocate a reward to one active reservation. | A concurrent second reservation cannot acquire the same reward. |
| FR-09 | Encrypt evidence before upload. | The application API receives ciphertext only. |
| FR-10 | Verify only the fixed fixture format. | Unknown formats and arbitrary executable content are rejected. |
| FR-11 | Derive the report from the assessed record. | Report contents correspond to the actual assessed input. |
| FR-12 | Bind a qualifying result to the claimant and policy. | Replay to a different claimant or bounty fails. |
| FR-13 | Credit the fixed reward once. | Sponsor actions cannot remove the credit. |
| FR-14 | Collect credit permissionlessly to the fixed beneficiary. | A sponsor signature is not required. |
| FR-15 | Release the report only after final payment. | Pending and reverted payments grant no organization access. |
| FR-16 | Recover expired or failed reservations. | Funds do not remain locked indefinitely before qualification. |
| FR-17 | Export reconciled receipts. | Exported amounts match final contract events. |
| FR-18 | Distinguish local, live testnet, and verifier trust modes. | Every relevant screen and receipt has the correct label. |
| FR-19 | Complete an outgoing Privy researcher transfer. | A final transaction proves the full financial flow. |
| FR-20 | Produce seven sponsor evidence records. | Each record links to working code and observed execution. |

## 11. Screens

| Route | Main content | Main action | Required non-success state |
| --- | --- | --- | --- |
| `/` | Product promise, fixture limit, selected integrations | Open app | Provider outage notice |
| `/app` | Role-aware overview | Open a program or claim | Empty account |
| `/app/organization` | Members, role controls, wallets | Invite or change role | Forbidden action |
| `/app/coverage` | Vault table, funding status, freshness | Ask coverage assistant | Stale or missing data |
| `/app/programs` | Program inventory | Create program | No program |
| `/app/bounties/new` | Policy review and funding | Fund bounty | Wallet policy rejection |
| `/app/bounties/:id` | Terms, reward, reservation, timeline | Submit fixture claim | Closed or reserved |
| `/app/claims/:id` | Private claim status and payment | Collect payment | Expired or failed job |
| `/app/reports/:id` | Authorized report view | Download report | Locked until payment |
| `/app/treasury` | Wallet funds, controller budget, escrow balances | Fund approved budget | Limit reached |
| `/app/automation` | Approved policies, limits, action history | Enable or disable | Data stale |
| `/app/receipts` | Filtered financial records | Export CSV | Pending reconciliation |
| `/app/wallet` | Researcher balance and transfers | Send USDC | Invalid recipient or low balance |
| `/app/status` | Public provider health and trust mode | Refresh status | Partial outage |

Do not expose internal provider keys, storage paths, or private receipt data on `/app/status`.

## 12. Interface direction

Use a clear financial workspace. Use a light neutral background, dark text, one blue action color, and restrained status colors. Show large financial amounts with their asset and network. Use tables for vaults and receipts. Use a timeline for claim progress.

Use one main action per screen. Put the next action beside the current state. Explain a rejected action in plain language. Keep transaction hashes behind “View transaction.” Keep technical evidence in an expandable details panel.

Support desktop at 1440 px and mobile at 390 px. Ensure keyboard access, visible focus, semantic labels, and WCAG 2.2 AA contrast. Never use color as the only status cue. Respect reduced-motion preferences. Do not animate financial balances during reconciliation.

## 13. Nonfunctional requirements

| ID | Target |
| --- | --- |
| NFR-01 | No plaintext evidence or report contents in application logs, analytics, traces, or error tools. |
| NFR-02 | Normal read API requests complete within 750 ms at p95 in the reference test, excluding external model and chain waits. |
| NFR-03 | Serve 25 concurrent users and 10 queued fixture jobs without lost jobs or duplicate payments. |
| NFR-04 | Show wallet and chain waits explicitly. Do not set a false fixed completion time. |
| NFR-05 | The fixture verifier normally completes within 30 seconds after reservation finality. |
| NFR-06 | Retry report release safely. Target release within 60 seconds of final payment under normal provider operation. |
| NFR-07 | Provide reproducible local setup, locked dependencies, test commands, and provider preflight checks. |
| NFR-08 | Keep database and object storage backups. Demonstrate restoration in a staging environment. |

## 14. Product metrics

Record funded bounties, active reservations, accepted claims, final payments, report delivery delay, provider failures, and blocked wallet actions. Record assistant recommendations accepted by a user and recommendations rejected because of stale data.

Use internal identifiers. Do not send evidence, report text, private prompts, wallet secrets, or organization names to third-party analytics.

## 15. Release definition

The release is complete only when the required outcomes and acceptance tests pass with live selected integrations. Missing credentials can block a live gate. They do not justify marking that gate complete.

Do not claim a sponsor win, guaranteed eligibility, production security, or real-vault vulnerability proof. The submission must accurately describe the implemented product and its limits.
