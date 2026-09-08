import { z } from "zod";
import { address, bytes32, DomainError, uint } from "../../domain/src/index.ts";
export const COVERAGE_QUERY = `query CoverageSources($ids: [ID!]!) {
 vaults(where: {id_in: $ids}, first: 100, orderBy: id) {
  id chainId address asset assetDecimals shareDecimals implementationLabel firstObservedBlock
  latestObservation {id blockNumber blockHash blockTimestamp totalAssets totalSupply readStatus schemaVersion}
 }
 sourceCursors(first: 10) {id chainId blockNumber blockHash blockTimestamp}
 _meta {deployment hasIndexingErrors block {number hash timestamp}}
}`;
const observationSchema = z.object({
  id: z.string(),
  blockNumber: uint(),
  blockHash: bytes32,
  blockTimestamp: uint(64),
  totalAssets: uint().nullable(),
  totalSupply: uint().nullable(),
  readStatus: z.enum(["OK", "PARTIAL"]),
  schemaVersion: z.literal("1"),
});
export const graphResponseSchema = z.object({
  vaults: z
    .array(
      z.object({
        id: z.string(),
        chainId: uint(),
        address,
        asset: address.nullable(),
        assetDecimals: z.number().int().min(0).max(255).nullable(),
        shareDecimals: z.number().int().min(0).max(255).nullable(),
        implementationLabel: z.string().nullable(),
        firstObservedBlock: uint(),
        latestObservation: observationSchema.nullable(),
      }),
    )
    .max(100),
  sourceCursors: z
    .array(
      z.object({
        id: z.string(),
        chainId: uint(),
        blockNumber: uint(),
        blockHash: bytes32,
        blockTimestamp: uint(64),
      }),
    )
    .max(10),
  _meta: z.object({
    deployment: z.string().min(1),
    hasIndexingErrors: z.boolean(),
    block: z.object({
      number: z.number().int().nonnegative(),
      hash: bytes32.nullable(),
      timestamp: z.number().int().nonnegative().nullable(),
    }),
  }),
});
export type VaultObservationDTO = {
  sourceId: string;
  vaultId: string;
  chainId: string;
  address: string;
  asset: string | null;
  assetDecimals: number | null;
  schemaVersion: "1";
  deploymentId: string;
  queryTime: string;
  observedBlock: string | null;
  observedHash: string | null;
  observedAt: string | null;
  indexedHead: string;
  indexedHeadAt: string | null;
  totalAssets: string | null;
  totalSupply: string | null;
  readStatus: "OK" | "PARTIAL" | "MISSING";
  hasIndexingErrors: boolean;
  label: string | null;
};
export function normalizeGraph(
  input: unknown,
  requestedIds: string[],
  queryTime = new Date(),
): VaultObservationDTO[] {
  const data = graphResponseSchema.parse(input);
  return data.vaults.map((v) => {
    if (v.id !== `${v.chainId}:${v.address}` || !requestedIds.includes(v.id))
      throw new DomainError("SOURCE_MISMATCH", "The source returned an unexpected vault.", 503);
    const o = v.latestObservation;
    if (o && BigInt(o.blockNumber) > BigInt(data._meta.block.number))
      throw new DomainError("SOURCE_MISMATCH", "The observation exceeds the indexed head.", 503);
    return {
      sourceId: o?.id ?? `${v.id}:missing`,
      vaultId: v.id,
      chainId: v.chainId,
      address: v.address,
      asset: v.asset,
      assetDecimals: v.assetDecimals,
      schemaVersion: "1",
      deploymentId: data._meta.deployment,
      queryTime: queryTime.toISOString(),
      observedBlock: o?.blockNumber ?? null,
      observedHash: o?.blockHash ?? null,
      observedAt: o ? new Date(Number(o.blockTimestamp) * 1000).toISOString() : null,
      indexedHead: String(data._meta.block.number),
      indexedHeadAt:
        data._meta.block.timestamp === null
          ? null
          : new Date(data._meta.block.timestamp * 1000).toISOString(),
      totalAssets: o?.totalAssets ?? null,
      totalSupply: o?.totalSupply ?? null,
      readStatus: o?.readStatus ?? "MISSING",
      hasIndexingErrors: data._meta.hasIndexingErrors,
      label: v.implementationLabel,
    };
  });
}
export class GraphCoverageClient {
  constructor(
    private endpoint: string,
    private expectedDeployment: string | null,
    private apiKey?: string,
  ) {
    const u = new URL(endpoint);
    if (u.protocol !== "https:" || u.username || u.password)
      throw new Error("Use an HTTPS Graph endpoint.");
  }
  async query(ids: string[]) {
    z.array(z.string().regex(/^[1-9][0-9]*:0x[0-9a-f]{40}$/))
      .min(1)
      .max(100)
      .parse(ids);
    const response = await fetch(this.endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ query: COVERAGE_QUERY, variables: { ids } }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new DomainError("PROVIDER_UNAVAILABLE", "The Graph is not available.", 503);
    const body = await response.text();
    if (body.length > 1_000_000)
      throw new DomainError("SOURCE_TOO_LARGE", "The source response exceeds its limit.", 503);
    const json = JSON.parse(body);
    if (json.errors?.length || !json.data)
      throw new DomainError("PROVIDER_UNAVAILABLE", "The Graph query did not complete.", 503);
    const data = graphResponseSchema.parse(json.data);
    if (this.expectedDeployment && data._meta.deployment !== this.expectedDeployment)
      throw new DomainError("SOURCE_MISMATCH", "The Graph deployment changed.", 503);
    return normalizeGraph(data, ids);
  }
}
