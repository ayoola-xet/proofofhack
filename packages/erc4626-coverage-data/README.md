# ERC-4626 coverage data

This package uses one schema and one query for three existing vault deployments. It reads public Ethereum data. It does not submit transactions to these vaults.

The current sources are Sky sDAI, Sky sUSDS, and Ethena sUSDe. Each source has a reference in `sources.json`. Source labels are metadata. They are not model instructions.

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

1. Run `pnpm --filter @vulnproof/erc4626-coverage-data codegen`.
2. Run `pnpm --filter @vulnproof/erc4626-coverage-data build`.
3. Set `GRAPH_DEPLOY_KEY` in the ignored environment file.
4. Run `pnpm exec tsx scripts/deploy-graph.ts v0.1.0` from the repository root.
5. Run `pnpm exec tsx scripts/capture-graph-evidence.ts` after indexing completes.

The application joins these observations with confirmed Arc bounty records in PostgreSQL. Arc settlement is not indexed by this subgraph.

The block schedule uses the documented [Graph polling filter](https://thegraph.com/docs/en/subgraphs/developing/creating/subgraph-manifest/#polling-filter).
