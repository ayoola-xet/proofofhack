# The Graph integration

Selected tracks: SP-01 and SP-02. Track rules were checked on 8 September 2026. See [the sponsor page](https://ethglobal.com/events/ethonline2026/prizes/the-graph). This record describes implementation evidence. It does not certify prize eligibility.

## Problem and integration

An organization needs to find vaults that lack funded fixture coverage. One ERC-4626 schema returns comparable source records for Sky sDAI, Sky sUSDS, and Ethena sUSDe. The application joins those records with final Arc bounty records. It keeps source units separate from USDC settlement units.

## SP-01: Composable or standardized products

The reusable package is [erc4626-coverage-data](../../packages/erc4626-coverage-data/README.md). Its schema, mappings, source catalog, query, and normalization code live in that directory. The same query reads all three vaults. Adding a supported vault reuses the schema and mapping.

[Live query evidence](live-query.json) records the deployed package and three source vaults. The observed deployment is `QmPiYxxLnHQczzQHcFHxsBdD7cxjdVQ2i4PjPeuMgUg4EC`. The client rejects unexpected deployments, failed reads, and stale records. It records observation age and indexed-head age separately.

This is a new shared schema for ERC-4626 coverage context. It does not claim compatibility with the complete Messari schema. Indexing starts at block 25929600. The data does not represent each vault's complete history.

## SP-02: AI tooling or AI use case, From Scratch

The deterministic coverage service identifies a funding gap. The Circle allocation evidence saves the actual Graph source reference and source time used for an approved allocation. See [the live allocation](../arc/budget-allocation-9c60762d-cd1d-4fad-ace3-b45f971d9c6e.json).

The coverage assistant can explain a saved calculation and cite its source records. Its model has no transaction tools or report access. Local tests check malicious metadata, stale records, invalid citations, and changed calculations. **The live model check remains incomplete.** A deterministic allocation does not prove a live model response.

## Run and inspect

1. Follow the package build and deployment instructions.
2. Configure `GRAPH_ENDPOINT` and `GRAPH_DEPLOYMENT_ID` in the ignored environment file.
3. Run `pnpm exec tsx scripts/capture-graph-evidence.ts`.
4. Run `pnpm test:ai` for the local coverage and model checks.
5. Start the configured app with `pnpm dev`. Open Vault coverage.

## Developer feedback and open work

The shared schema removes separate query code for each vault. A separate observation time prevents an advancing indexed head from hiding stale metric reads. Explicit null metrics preserve read failures.

Public repository access, the live model demonstration, hosted operation, and the final video remain open. Graph data supplies context. It does not prove a vulnerability.
