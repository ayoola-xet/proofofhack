# ERC-4626 coverage data

This package uses one schema, one shared indexing mapping, and one query client for any number of ERC-4626 vault deployments. It reads public Ethereum data. It does not submit transactions to these vaults.

Every source lives in `sources.json`; `subgraph.yaml` is generated from it, not hand-written. Covering one more vault, on any of The Graph's supported EVM networks, is a one-line addition to `sources.json`, not a new hand-authored data source. Source labels are metadata. They are not model instructions.

Currently indexed: Sky sDAI, Sky sUSDS, Ethena sUSDe, plus one clearly-labeled synthetic example entry demonstrating the addition path.

## Covering another vault

1. Add an entry to `sources.json` with the vault's `name`, `chainId`, `network`, `address`, `label`, `implementation`, and `source` reference.
2. Run `pnpm --filter @proofofhack/erc4626-coverage-data generate-manifest` (or `codegen`/`build`, which run it first) to regenerate `subgraph.yaml`.
3. Redeploy per the steps below. The schema, mapping, and query client require no changes.

## Data rules

- Record deposits and withdrawals as separate immutable flows.
- Read vault totals every ten Ethereum blocks.
- Record the observation block and indexed head separately.
- Keep unavailable metrics null.
- Keep every amount as an integer string in the query client.
- Reject an unexpected deployment or vault in the query client.
- Check observation age and indexed head age before making a coverage recommendation.

The first indexed block is 25929600. This is a bounded observation window. It is not the vault deployment block. The dataset does not claim complete lifetime deposit or withdrawal history.

## Build

1. Run `pnpm --filter @proofofhack/erc4626-coverage-data codegen`.
2. Run `pnpm --filter @proofofhack/erc4626-coverage-data build`.
3. Set `GRAPH_DEPLOY_KEY` in the ignored environment file.
4. Run `pnpm exec tsx scripts/deploy-graph.ts v0.1.0` from the repository root.
5. Run `pnpm exec tsx scripts/capture-graph-evidence.ts` after indexing completes.

The application joins these observations with confirmed Arc bounty records in PostgreSQL. Arc settlement is not indexed by this subgraph.

The block schedule uses the documented [Graph polling filter](https://thegraph.com/docs/en/subgraphs/developing/creating/subgraph-manifest/#polling-filter).
