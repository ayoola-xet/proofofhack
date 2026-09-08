# Sponsor requirements and evidence

Checked: 8 September 2026  
Selected sponsors: The Graph, Arc, Privy  
Assumed event track: Classic / From Scratch

## 1. Selection rule

Select these three sponsors in the submission form. Apply under all relevant tracks within those selections. Do not select a Continuity award for a From Scratch entry. Multiple-track eligibility does not establish that one team can collect all awards.

Confirm award stacking and unspecified distributions before using an aggregate award figure in planning. Do not use a prize estimate as a product success criterion. [ETHGlobal rules](https://ethglobal.com/events/ethonline2026/info/details)

## 2. Seven track mappings

Track names below follow the user-supplied prize text. Evidence must reflect the implementation that actually runs.

| ID | Sponsor and track | Required product evidence | Main tests |
| --- | --- | --- | --- |
| SP-01 | The Graph: Best Use of Composable or Standardized Graph Products | Reusable coverage package, shared schema, same query across live vault deployments, methodology, public code | GRA-01 through GRA-04 |
| SP-02 | The Graph: Best AI Tooling or AI Use Case with The Graph (From Scratch) | Live Graph records drive a useful coverage recommendation; source references and changed-input demonstration | AI-01 through AI-05 |
| SP-03 | Arc: Best DeFi/Onchain Finance Application | Funded USDC bounty, fixed terms, reserved credit, actual payment, reconciliation | WAL-01; ESC-01 through ESC-16 |
| SP-04 | Arc: Best Agentic Economy Application with Circle Agent Stack | Real Circle wallet action, approved policy selection, onchain limits, action receipt | AGT-01 through AGT-06 |
| SP-05 | Arc: Launch on Arc Testnet & Push to Mainnet | Working frontend and backend, deployment manifest, architecture, operational readiness record | End-to-end scenario; OPS-01 through OPS-05 |
| SP-06 | Privy: Best B2B financial product | Organization wallet, real wallet control, allowed funding, prohibited action rejection | AUTH tests; WAL-01 and WAL-02 |
| SP-07 | Privy: Best financial flow | Researcher wallet onboarding, received payment, final outgoing transfer, clear receipt | WAL-03 and WAL-04; UX tests |

Primary references: [The Graph](https://ethglobal.com/events/ethonline2026/prizes/the-graph), [Arc](https://ethglobal.com/events/ethonline2026/prizes/arc), and [Privy](https://ethglobal.com/events/ethonline2026/prizes/privy).

## 3. Qualification limits

The Graph requires live provider data. A local graph, static JSON, or one unrelated raw query does not complete the selected tracks. The AI demonstration must do useful work with the data.

Arc’s launch track requires deployment or deployment readiness on mainnet by September 30. Record what readiness means and what remains outstanding. A testnet transaction alone does not establish production readiness.

Privy requires a real wallet integration. Its financial-flow track requires a functional generally available feature. A mocked card or commercially gated feature does not replace the required wallet action.

These are qualification conditions from the linked sponsor pages. The specific architecture and test cases in this package are the team’s proposed implementation.

## 4. Evidence package

Create one folder for each sponsor. Include a short README with the problem, exact integration, code paths, setup, execution evidence, known limits, and developer feedback. Each track must have its own evidence subsection.

```text
evidence/the-graph/README.md
evidence/arc/README.md
evidence/privy/README.md
evidence/live-manifest.json
evidence/test-summary.json
docs/AI_USAGE.md
docs/IMPLEMENTATION_STATUS.md
docs/MAINNET_READINESS.md
```

Keep credentials and report contents out of public evidence. Show the fixture label and trusted-service verifier mode. Do not show a successful local test as a successful live provider call.

## 5. Demo sequence

Target a three-minute-forty-second main video:

| Time | Demonstration |
| --- | --- |
| 0:00-0:20 | Explain the payment and disclosure problem. State the fixture scope. |
| 0:20-0:50 | Show organization wallet controls and a blocked operation. |
| 0:50-1:20 | Show live Graph coverage and a source-backed recommendation. |
| 1:20-1:50 | Show Circle funding an approved policy on Arc. |
| 1:50-2:35 | Show private fixture submission, qualification, and actual payment. |
| 2:35-3:00 | Show report release and researcher transfer. |
| 3:00-3:25 | Show the nonqualifying control and absence of payment. |
| 3:25-3:40 | Show reusable code, trust limits, and deployment evidence. |

Use real application states. Edit waiting periods only when allowed by the event rules. Do not fabricate transactions or compress playback to imply a false completion time. The event currently requires a 2-4 minute video. Recheck current video and narration rules before recording. [Submission requirements](https://ethglobal.com/events/ethonline2026/info/details)

## 6. Alternative sponsor

Hedera remains the first alternative. Switching requires an explicit decision because it changes the wallet, payment, and evidence plan. Do not build a fourth sponsor into the default release. Preserve the selected product’s core payment and confidentiality behavior if a later switch occurs.
