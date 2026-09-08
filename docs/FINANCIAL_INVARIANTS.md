# Financial invariant tests

The local contract suite includes a random-action test for the escrow. An invariant is a rule that must hold after each action. The test uses an independent record of expected rewards and token transfers. It compares that record with the actual contract state and token balances.

## Run the suite

Use Foundry v1.5.0 and the pinned repository dependencies.

```sh
pnpm test:contracts
```

To reproduce the saved campaign, use:

```sh
forge test --root contracts --json --fuzz-seed 7632026
```

The configuration runs 128 sequences with 64 actions per sequence. Unexpected handler reverts fail the test. Handler metrics show calls, reverts, and discarded inputs. This follows the [Foundry invariant test model](https://getfoundry.sh/forge/invariant-testing).

The sanitized result is in `evidence/local/contract-tests.json`. It contains 19 passing contract tests. One result contains the 8,192-action campaign and its ten action counts. The result also records the tool version, compiler version, seed, source commit, and source file hashes. A capture can include uncommitted source changes. Use its hashes to identify the tested files.

## Model and actions

`contracts/test/SettlementInvariant.t.sol` creates one escrow and a local token. It uses four claimant addresses, four fixed refund addresses, and an unrelated relayer. The token has no monetary value. It can fail outgoing transfers for rollback tests.

The handler starts with six bounties. It prepares funded, reserved, and qualified states before random actions begin. It can create up to 32 bounties in one sequence. Each reward ranges from one base unit to 50,000,000 base units.

The runner chooses these actions and their inputs:

- Create a bounty with a fixed reward and refund address.
- Reserve a claim for a selected claimant.
- Qualify or reject a reserved claim.
- Submit an assessment with one changed binding or the wrong signer.
- Replay a consumed admission with a fresh expiry and signature.
- Expire a reservation before or after its expiry.
- Collect a payment, with or without an injected transfer failure.
- Refund a bounty, with or without an injected transfer failure.
- Send tokens directly to the escrow.
- Advance time across reservation and settlement deadlines.

Actions that need an eligible bounty can return without a contract call. Metrics therefore count handler calls, including these no-ops. A separate deterministic test exercises rejection, replay, failed transfer rollback, expiry, payment, and refund paths.

## Required properties

| Property | Assertion |
| --- | --- |
| Asset conservation | Escrow balance equals outstanding rewards plus unsolicited transfers. |
| Global liability | Contract liability equals funded rewards minus paid and refunded rewards. |
| Per-bounty accounting | Each bounty has its exact unallocated reward, exact claimant credit, or no liability according to its expected state. |
| Recipient binding | Each claimant and refund address receives its independently recorded total. The relayer receives zero. |
| Policy integrity | The stored policy still hashes to the original bounty ID. |
| Report integrity | Qualified and paid bounties retain the report commitment used in the assessment. |
| Admission uniqueness | Used claim IDs and admission nonces remain consumed. |
| Rollback | A failed payment or refund leaves state and balances equal to the prior model. |
| Recovery | After each sequence, time advances beyond all deadlines. Every outstanding credit is collected and every unallocated reward is refunded. Only unsolicited tokens remain in escrow. |

The model updates expected balances from the requested action and its defined result. It does not read contract credit or liability values to set those expected balances. The runner checks all properties after each random action. `afterInvariant` performs the final recovery check.

## Acceptance coverage

This campaign provides local contract evidence for `ESC-15` and `ESC-16`. It also checks policy integrity, recipient binding, replay protection, and transfer rollback across mixed states. The existing contract tests retain their specific admission, signature-domain, deadline, and controller scenarios.

The changed-assessment action covers policy hash, claim ID, claimant, evidence commitment, adapter hash, verifier configuration hash, reward, assessment time, expiry, and signer. It preserves the saved model when the contract rejects the request.

The focused review uses the local security checklist questions for withdrawal behavior (`SOL-AM-DOSA-1`), balance-based accounting (`SOL-AM-DA-1`), accounting under exceptional conditions (`SOL-CR-1`), and signature replay and authority (`SOL-Signature-1`, `SOL-Signature-3`, `SOL-Signature-4`, `SOL-Signature-5`). Blacklist, rebasing, fee-on-transfer, and callback behavior remain outside this campaign.

## Limits

This is a finite local test campaign. It uses a standard local ERC-20 token with an outgoing-transfer failure switch. It assumes trusted admission and assessment signers. It does not test signer compromise, arbitrary token callbacks, rebasing, fee-on-transfer tokens, or removal of a token blacklist.

The budget controller has separate contract tests. This random-action handler covers the escrow only. It does not establish live provider behavior, hosted recovery, or a complete security review. Independent review and the [mainnet readiness work](MAINNET_READINESS.md) remain required.
