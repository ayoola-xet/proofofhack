import type { Pool } from "pg";
import { z } from "zod";
import { address, bytes32, policySchema } from "../packages/domain/src/index.ts";
import { type ApiOperation, apiOperations } from "../services/api/src/api-contract.ts";
import { createApp } from "../services/api/src/app.ts";
import { pageParams } from "../services/api/src/context.ts";
import {
  hashPageParams,
  headerSchemas,
  pathSchemas,
  requestSchemas,
} from "../services/api/src/request-schemas.ts";

type Json = Record<string, unknown>;
export function schema(input: z.ZodType, io: "input" | "output" = "input"): Json {
  return z.toJSONSchema(input, {
    io,
    target: "draft-2020-12",
    cycles: "throw",
    override: (context) => {
      if (context.zodSchema === address) {
        context.jsonSchema.type = "string";
        context.jsonSchema.pattern = "^0x[0-9a-fA-F]{40}$";
        context.jsonSchema.description =
          "EVM address. The server validates it and stores lowercase hex.";
      }
    },
  });
}
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (shape: Json) => ({ "application/json": { schema: shape } });
const errorResponse = {
  description:
    "The request failed. The error code is stable. The message contains no private provider details.",
  content: json(ref("ApiError")),
};
const error = { $ref: "#/components/responses/ApiError" };
const object: Json = { type: "object", additionalProperties: true };
const list: Json = {
  type: "object",
  required: ["items"],
  properties: { items: { type: "array", items: object } },
  additionalProperties: true,
};
const descriptions: Partial<Record<keyof typeof requestSchemas, string>> = {
  memberUpdate: "Supply role, status, or both. The last active owner cannot be removed.",
  coveragePolicy:
    "minReward is positive and less than 2^256. Every allowed vault belongs to this organization.",
  bountyDraft:
    "Select exactly one of refundWalletId or controllerId. Reward and minimumDiscrepancy are positive uint256 decimal strings. submissionDeadline is uint64. The server also checks deadlines, the signed manifest, source freshness, and wallet ownership.",
  treasurySetup:
    "maxPerAction is from 1 to 100000000 base units, inclusive. This is at most 100 test USDC.",
  transfer:
    "amount is a positive uint256 decimal string. The recipient must be a nonzero EVM address. The server uses the fixed Arc Testnet USDC contract.",
  ownerRequest:
    "Amounts are from 1 to 100000000 base units. The daily limit must be at least the per-action limit. expiresAt is uint64. The server checks the exact approved policy, current controller owner, and final chain state.",
  receiptFilters:
    "from is inclusive and to is exclusive. When both exist, from must precede to. Personal exports include PAYMENT only. An export contains at most 1000 matching final receipts.",
  arcRpc:
    "One JSON-RPC request or a batch of at most ten requests. The route limits the whole body to 50000 bytes. Read methods are allowlisted. Contract calls use the fixed Arc USDC address. Signed sends and gas estimates must match saved user transfer intents. Rejected methods return a JSON-RPC error inside HTTP 200.",
  assistantQuestion:
    "The server trims the question. The organization must have a current coverage snapshot. At most ten requests per organization per hour and two active requests are allowed. The model has no wallet or private evidence tools.",
};
const listIds = new Set([
  "programs",
  "bounties",
  "coverage",
  "reports",
  "myWallets",
  "manifests",
  "bountyDrafts",
  "fundingRequests",
  "myClaims",
  "coverageSources",
  "coveragePolicies",
  "recommendations",
  "controllers",
  "controllerApprovals",
  "allocations",
  "ownerRequests",
  "assistantRuns",
  "walletTransfers",
  "organizationReceipts",
  "personalReceipts",
  "organizationExports",
  "personalExports",
  "recovery",
]);

function successShape(operation: ApiOperation): Json {
  if (operation.id === "health") return ref("Health");
  if (operation.id === "currentUser") return ref("CurrentUser");
  if (operation.id === "bounty") return ref("Bounty");
  if (operation.id === "prepareUpload") return ref("UploadDestination");
  if (operation.id === "uploadCiphertext") return ref("CompletedUpload");
  if (["exportStatus", "downloadExport"].includes(operation.id)) return ref("ExportMetadata");
  if (operation.id === "arcRpc")
    return {
      oneOf: [
        ref("RpcResponse"),
        { type: "array", minItems: 1, maxItems: 10, items: ref("RpcResponse") },
      ],
    };
  if (listIds.has(operation.id)) {
    const shape = structuredClone(list);
    if (operation.pagination) {
      shape.required = ["items", "nextCursor"];
      shape.properties = {
        ...(shape.properties as Json),
        nextCursor: { type: ["string", "null"] },
      };
    }
    return shape;
  }
  return {
    ...object,
    description:
      "Authorized resource or operation metadata. Additional fields depend on the resource and its saved state. See the route implementation for the full current projection.",
  };
}
function parameters(operation: ApiOperation) {
  const fields: Json[] = [];
  for (const match of operation.path.matchAll(/:([a-zA-Z]+)/g)) {
    const isHash = operation.path.startsWith("/api/v1/bounties/") && match[1] === "id";
    fields.push({
      name: match[1],
      in: "path",
      required: true,
      schema: schema(isHash ? pathSchemas.hash.shape.id : pathSchemas.uuid.shape.id),
    });
  }
  if (operation.body && operation.id !== "arcRpc")
    fields.push({
      name: "Idempotency-Key",
      in: "header",
      required: true,
      description:
        "Reuse this key only for identical input. The server keeps the request hash for at least 24 hours. A changed request returns 409.",
      schema: schema(headerSchemas.idempotency),
    });
  if (operation.version)
    fields.push({
      name: "If-Match",
      in: "header",
      required: true,
      description: "Current positive safe-integer resource version. A stale version returns 409.",
      schema: schema(headerSchemas.version),
    });
  if (operation.pagination) {
    const pageSchema = operation.pagination === "hash" ? hashPageParams : pageParams;
    const page = {
      limit: schema(pageSchema.shape.limit, "output"),
      cursor: schema(pageSchema.shape.cursor),
    };
    fields.push({ name: "limit", in: "query", required: false, schema: page.limit });
    fields.push({
      name: "cursor",
      in: "query",
      required: false,
      schema: page.cursor,
    });
    if (operation.pagination === "receipts") {
      const filters = schema(requestSchemas.receiptFilters).properties as Json;
      for (const [name, shape] of Object.entries(filters))
        fields.push({ name, in: "query", required: false, schema: shape });
    }
  }
  return fields;
}

export function assertRouteInventory(actual: readonly { method: string; path: string }[]) {
  const expected = new Set(apiOperations.map((route) => `${route.method} ${route.path}`));
  const registered = new Set(actual.map((route) => `${route.method} ${route.path}`));
  if (
    expected.size !== apiOperations.length ||
    new Set(apiOperations.map((route) => route.id)).size !== apiOperations.length
  )
    throw new Error("API operation identifiers and routes must be unique.");
  if (registered.size !== expected.size || [...expected].some((key) => !registered.has(key)))
    throw new Error("The registered API routes differ from the documented operation inventory.");
}
export async function buildOpenApi() {
  const registered: { method: string; path: string }[] = [];
  const app = await createApp({
    appEnv: "local",
    webOrigin: "http://127.0.0.1:5173",
    pool: new Proxy({} as Pool, {
      get: () => {
        throw new Error("OpenAPI generation cannot access a database.");
      },
    }),
    auth: {
      verify: async () => {
        throw new Error("OpenAPI generation cannot authenticate users.");
      },
    },
    onRoute: (route) => {
      for (const method of Array.isArray(route.method) ? route.method : [route.method])
        if (!["HEAD", "OPTIONS"].includes(method)) registered.push({ method, path: route.url });
    },
  });
  try {
    await app.ready();
    assertRouteInventory(registered);
  } finally {
    await app.close();
  }
  const components: Record<string, Json> = {
    ApiError: schema(
      z.strictObject({
        error: z.strictObject({
          code: z.string(),
          message: z.string(),
          requestId: z.string(),
          retryable: z.boolean(),
        }),
      }),
    ),
    Health: schema(
      z.strictObject({
        status: z.literal("available"),
        environment: z.enum(["local", "arc-testnet"]),
      }),
    ),
    CurrentUser: {
      type: "object",
      required: ["user", "memberships", "wallets"],
      properties: {
        user: schema(z.object({ id: z.uuid(), displayName: z.string() })),
        memberships: { type: "array", items: object },
        wallets: { type: "array", items: object },
      },
    },
    BountyPolicy: schema(policySchema),
    Bounty: {
      type: "object",
      required: ["bounty_id", "reward", "policy", "chain_state", "chain_id", "escrow"],
      properties: {
        bounty_id: schema(bytes32),
        reward: { type: "string", pattern: "^[0-9]+$" },
        policy: ref("BountyPolicy"),
        unallocated_reward: { type: "string" },
        claimant_credit: { type: "string" },
        chain_state: { type: "string" },
        chain_id: { type: "string" },
        escrow: schema(address),
        creation_tx: schema(bytes32),
        version: { type: "integer" },
      },
    },
    UploadDestination: schema(
      z.object({
        uploadId: z.uuid(),
        claimId: bytes32,
        uploadPath: z.string(),
        state: z.literal("UPLOADING"),
        expiresInSeconds: z.literal(900),
      }),
    ),
    CompletedUpload: schema(
      z.object({ uploadId: z.uuid(), claimId: bytes32, state: z.literal("ADMISSION_PENDING") }),
    ),
    ExportMetadata: schema(
      z.object({
        id: z.uuid(),
        state: z.string(),
        errorCode: z.string().nullable(),
        contentHash: z.string().nullable(),
        rowCount: z.number().int(),
        createdAt: z.iso.datetime(),
        completedAt: z.iso.datetime().nullable(),
      }),
    ),
    RpcResponse: {
      type: "object",
      required: ["jsonrpc", "id"],
      properties: {
        jsonrpc: { const: "2.0" },
        id: { type: ["string", "integer", "null"] },
        result: {},
        error: {
          type: "object",
          required: ["code", "message"],
          properties: { code: { type: "integer" }, message: { type: "string" } },
        },
      },
      oneOf: [{ required: ["result"] }, { required: ["error"] }],
    },
  };
  for (const [name, value] of Object.entries(requestSchemas)) {
    components[`Request_${name}`] = schema(value);
    if (descriptions[name as keyof typeof requestSchemas])
      components[`Request_${name}`].description = descriptions[name as keyof typeof requestSchemas];
  }
  const paths: Record<string, Json> = {};
  for (const operation of [...apiOperations].sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  )) {
    const path = operation.path.replace(/:([a-zA-Z]+)/g, "{$1}");
    const success: Json = {
      description:
        operation.status === 202
          ? "The operation is queued. This is not proof of final chain settlement."
          : "The request completed. Financial state is final only where explicitly recorded as final.",
      content: json(successShape(operation)),
    };
    if (operation.id === "downloadExport") {
      success.content = { "text/csv": { schema: { type: "string" } } };
      success.headers = {
        "X-Content-SHA256": {
          required: true,
          description: "SHA-256 of the exact CSV bytes. Verify before saving.",
          schema: { type: "string", pattern: "^[0-9a-f]{64}$" },
        },
      };
    }
    const responses: Json = {
      [operation.status]: success,
      "400": error,
      "401": error,
      "403": error,
      "404": error,
      "409": error,
      "410": error,
      "413": error,
      "415": error,
      "429": error,
      "503": error,
    };
    if (operation.id === "downloadExport")
      responses["202"] = {
        description: "The export is not ready. Read its metadata and state.",
        content: json(ref("ExportMetadata")),
      };
    const item: Json = {
      operationId: operation.id,
      summary: operation.summary,
      description: `${operation.access} All response metadata uses Cache-Control: no-store. Custom schema refinements and current role, wallet, source, and chain checks remain server requirements.`,
      security: ["health", "arcRpc"].includes(operation.id) ? [] : [{ PrivyBearer: [] }],
      parameters: parameters(operation),
      responses,
    };
    if (operation.body)
      item.requestBody = {
        required: !operation.optionalBody,
        content: json(
          operation.optionalBody
            ? { anyOf: [ref(`Request_${operation.body}`), { type: "null" }] }
            : ref(`Request_${operation.body}`),
        ),
      };
    if (operation.binary)
      item.requestBody = {
        required: true,
        description:
          "Raw ciphertext bytes. The exact size and hash must match the prepared upload. No plaintext JSON or multipart body is accepted.",
        content: {
          "application/octet-stream": {
            schema: { type: "string", format: "binary", maxLength: 262192 },
          },
        },
      };
    paths[path] ??= {};
    paths[path][operation.method.toLowerCase()] = item;
  }
  return {
    openapi: "3.1.1",
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    info: {
      title: "ProofOfHack application API",
      version: "0.1.0",
      description:
        "Generated from implemented request schemas and checked against registered routes. Arc Testnet only for live funds. Fixture verification uses FIXTURE_ONLY and TRUSTED_SERVICE. Private report downloads and internal service routes are separate services. Response projections without a dedicated DTO schema remain open objects; this contract does not promise undocumented fields.",
    },
    servers: [{ url: "/", description: "The configured API origin" }],
    paths,
    components: {
      responses: { ApiError: errorResponse },
      securitySchemes: {
        PrivyBearer: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "Privy access token",
          description:
            "The API verifies the token and rechecks current database membership. Local test identities work only with the explicit local adapter.",
        },
      },
      schemas: components,
    },
  };
}
