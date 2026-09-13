import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Regenerates subgraph.yaml from sources.json, so covering one more ERC-4626
// vault (on any of The Graph's supported EVM networks) is a one-line config
// change instead of a hand-written dataSource block. This is the composable
// primitive: the schema, mapping, and query client are already shared across
// every source; only the deploy-time source list ever grows.
// Resolved relative to this script's own location, so it works whether it's
// invoked from the repo root or from within the package directory.
const PACKAGE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../packages/erc4626-coverage-data",
);
const DEFAULT_START_BLOCK = 25929600;

const sourceSchema = z.object({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/, "Use a PascalCase data source name."),
  chainId: z.string().regex(/^[1-9][0-9]*$/),
  network: z.string().min(1).default("mainnet"),
  address: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .transform((v) => v.toLowerCase()),
  label: z.string().min(1),
  implementation: z.string().min(1),
  startBlock: z.number().int().nonnegative().default(DEFAULT_START_BLOCK),
  synthetic: z.boolean(),
  source: z.string().min(1),
});

function dataSourceBlock(source: z.infer<typeof sourceSchema>) {
  return `  - kind: ethereum
    name: ${source.name}
    network: ${source.network}
    source:
      address: '${source.address}'
      abi: ERC4626
      startBlock: ${source.startBlock}
    context:
      chainId:
        type: String
        data: '${source.chainId}'
      implementationLabel:
        type: String
        data: '${source.label}'
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.9
      language: wasm/assemblyscript
      entities: [Vault, VaultObservation, VaultFlow, SourceCursor]
      abis:
        - name: ERC4626
          file: ./abis/ERC4626.json
      eventHandlers:
        - event: Deposit(indexed address,indexed address,uint256,uint256)
          handler: handleDeposit
        - event: Withdraw(indexed address,indexed address,indexed address,uint256,uint256)
          handler: handleWithdraw
      blockHandlers:
        - handler: handleBlock
          filter:
            kind: polling
            every: 10
      file: ./mapping.ts`;
}

async function main() {
  const raw = JSON.parse(await readFile(resolve(PACKAGE_DIR, "sources.json"), "utf8"));
  const sources = z.array(sourceSchema).min(1).parse(raw);
  const names = new Set(sources.map((s) => s.name));
  if (names.size !== sources.length) throw new Error("Source names must be unique.");
  const manifest = `specVersion: 1.3.0
description: Standardized public ERC-4626 observations for ProofOfHack coverage.
schema:
  file: ./schema.graphql
indexerHints:
  prune: auto
dataSources:
${sources.map(dataSourceBlock).join("\n")}
`;
  await writeFile(resolve(PACKAGE_DIR, "subgraph.yaml"), manifest);
  console.log(`Generated subgraph.yaml from ${sources.length} sources in sources.json.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
