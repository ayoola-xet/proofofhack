# Mainnet readiness

Reviewed: 8 September 2026

**Status: NOT READY for mainnet funds.** The current product operates on Arc Testnet. Its verifier accepts fixed synthetic accounting cases. It does not verify general smart-contract vulnerabilities.

## Readiness record

| Area | Current evidence | Required next work |
| --- | --- | --- |
| Contract and financial review | Local contract tests cover settlement, limits, refunds, and accounting. Live receipts prove testnet funding and payment. | Obtain an independent review of contracts, signatures, accounting, and deployment bindings. Record findings and their resolution. |
| Verifier trust | `TRUSTED_SERVICE` and `FIXTURE_ONLY` are explicit. The verifier signs the result. Separate services encrypt and release report copies. | Review signer compromise, privileged service access, data handling, and the intended production verification method. |
| Network and asset | Arc Testnet chain ID 5042002 and USDC address `0x3600000000000000000000000000000000000000` are checked. | Verify actual mainnet support, network identity, asset decimals, finality, provider support, and contract addresses. Do not reuse testnet configuration. |
| Wallet control | Privy checks allowed and prohibited calls. Owner actions restore the base signing policy. Circle allocation requires an exact on-chain approval and spending limits. | Review production ownership, independent operator access, signing policy coverage, recovery, and key rotation. Test those controls with separate actors. |
| Fund limits and incidents | Testnet spending limits and disablement exist. Pending transactions retain their original intent. | Define production fund caps, incident owners, alerts, response times, emergency procedures, and reconciliation duties. |
| Hosting and isolation | Separate local service processes run. API access does not provide private report keys. | Deploy isolated services, private networks, distinct credentials, and restricted storage access. Verify the hosted permissions. Local processes do not prove hosted isolation. |
| Backups and retention | Local tests restore a database, encrypted objects, and keys. Retention removes restored expired objects. | Verify hosted backup encryption, custody, expiry, recovery access, and a staging restore followed by chain reconciliation. |
| Monitoring and recovery | Durable jobs and local recovery tests exist. A live automatic refund has final receipt evidence. Live reservation-expiry evidence remains incomplete. | Verify live recovery, provider failures, restart recovery, monitoring, and operational alerts. |
| Public claims | The app states that Graph supplies context and that synthetic cases do not prove a vault vulnerability. | Review the final site, sponsor evidence, and demo for the same limits. Do not imply general vulnerability verification or protection against the verifier operator. |

## Release rule

Keep production accounts and mainnet signing disabled until the required reviews and operational checks pass. Record the deployed source commit and every open finding. A testnet payment or a sponsor deadline does not establish production readiness.

Use [the acceptance tests](ACCEPTANCE_TESTS.md) for functional checks. Use [the retention and recovery runbook](RETENTION_AND_RECOVERY.md) for storage recovery. Use [implementation status](IMPLEMENTATION_STATUS.md) for current build evidence. This record does not claim that the Arc launch award requirements are complete.
