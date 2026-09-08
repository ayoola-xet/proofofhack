# Privy integration

Selected tracks: SP-06 and SP-07. Track rules were checked on 8 September 2026. See [the sponsor page](https://ethglobal.com/events/ethonline2026/prizes/privy). This record does not certify prize eligibility.

## Problem and integration

An organization needs a controlled funding wallet. A researcher needs a wallet to receive and transfer a reward. Privy supplies login, verified embedded wallets, organization wallet policies, and owner signatures. The API checks current organization membership for each protected action.

## SP-06: B2B financial product

The organization wallet funds an approved bounty. Each funding confirmation binds the full policy, actor, wallet, expiry, and fee cap. [Arc funding evidence](../arc/bounty-funding.json) verifies the resulting transaction.

[Owner action evidence](owner-actions-0e36ddc6-5cfa-46cf-8c2f-6e9ad0d5fdb8.json) verifies six final transactions. They set limits, deposit funds, approve two policies, enable allocation, and withdraw unused funds. The capture checks the current restored provider policy.

The `treasury-funding-*.json` records distinguish allowed signing from rejected organization, asset, and amount changes. These signing checks do not broadcast transactions. [Owner control details](OWNER_CONTROLS.md) describe the temporary policy boundary. The application verifies the selected enable/disable value because Privy does not enforce that Boolean field in this integration.

## SP-07: Financial flow

The claimant receives one test USDC from final settlement. The claimant then sends one test USDC through the Privy embedded wallet. [Post-payment transfer evidence](outgoing-transfer-bd232fd2-fd37-442e-9a22-969d8fa7e35c.json) checks the payment and outgoing transfer receipts, claimant address, amount, and block order.

The wallet UI displays one test-USDC balance and retains a gas reserve. The browser uses a bounded RPC relay. The relay validates the saved intent and signed bytes before broadcast. A lost response reuses the saved transaction hash.

## Run and inspect

1. Follow [the repository setup](../../README.md). Configure the Privy app and allowed local origin.
2. Configure keys through the setup scripts. Do not commit keys or tokens.
3. Run `pnpm test:integration` for local identity, funding, and owner control checks.
4. Start `pnpm dev`. Open Organization to inspect the funding wallet and owner controls.
5. Open Wallet to inspect the reward wallet and transfer receipts.

Integration code lives in `packages/privy`, `services/treasury`, `services/budget`, `services/api`, and `apps/web`. Evidence capture scripts live in `scripts`.

## Developer feedback and limits

Direct provider broadcast rejected this app's Arc chain authorization. The integration uses policy-checked `eth_signTransaction`. The application verifies every returned transaction field, saves signed bytes, and then broadcasts through the configured Arc RPC.

The live owner and claimant currently use the same Privy account. Local tests use separate actors. Separate live account isolation, hosted operation, a public repository, and the final video remain open. No card, onramp, or commercially gated feature is claimed.
