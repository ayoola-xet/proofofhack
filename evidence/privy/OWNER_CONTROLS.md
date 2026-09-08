# Owner-control permission checks

Date: 8 September 2026.

These checks use the live Privy organization wallet on Arc Testnet. They request transaction signatures. They do not broadcast transactions, move funds, or substitute for an owner confirmation in the application.

Controller: `0x999c73e9bb9f70013f7a20cddd97c9633b094dda`.
Organization wallet: `0x6dd9e77782bbb10268abfa04663a062f3ca30768`.

| File suffix | Allowed request | Prohibited request | Argument control |
| --- | --- | --- | --- |
| `enabled.json` | Call `setEnabled(false)` on the controller. | Send that call to another destination. | The application checks the Boolean value against the signed owner message. Privy restricts the chain, destination, function, zero native value, and expiry. |
| `limits.json` | Set the saved per-action amount, daily amount, and interval. | Increase the per-action amount. | Privy fixes all three arguments. |
| `deposit.json` | Transfer one USDC base unit to the controller. | Transfer two base units. | Privy fixes the recipient and amount. |
| `withdraw.json` | Request one USDC base unit from the controller. | Request two base units. | Privy fixes the amount. The contract fixes the recipient. |
| `approval.json` | Approve the saved test hash, reward, and expiry. | Change the reward. | Privy fixes all three arguments. |

The file prefix is `owner-policy-0e36ddc6-5cfa-46cf-8c2f-6e9ad0d5fdb8-`. Each current file records `PASS`, `restored: true`, and `broadcast: false`. It also records the tested commands, prohibited destination, control boundary, and rule hash. The rule hash is SHA-256 of `canonicalTreasuryRules(ownerPermissionRules(...))` for that record's expiry.

Earlier attempts include failures. The initial file without a suffix and files in `owner-policy-attempts/` are history. Do not count them as current passing evidence. In particular, the failed Boolean-condition attempts do not establish Privy enforcement of the enabled state.

Run `scripts/check-owner-policy.ts` with the controller database ID and one case name: `enabled`, `limits`, `deposit`, `withdraw`, or `approval`. The script requires the existing local testnet configuration. It uses the same wallet lock as funding and refuses to run while a wallet action is pending. A normal retry preserves the saved request ID. Use `--new-attempt` only for a distinct test. That option verifies the base policy and archives the earlier record first.

The local integration tests separately verify exact owner signatures, immutable commands, transaction-byte checks, policy cleanup, final-event checks, and retry behavior. The live owner transaction and allocation journey remains pending.
