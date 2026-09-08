import { readFile } from "node:fs/promises";
import SwaggerParser from "@apidevtools/swagger-parser";
import type { FastifyRequest } from "fastify";
import { expect, it } from "vitest";
import { assertRouteInventory, buildOpenApi } from "../scripts/openapi.ts";
import { apiOperations } from "../services/api/src/api-contract.ts";
import { parseApiBody } from "../services/api/src/parse-body.ts";

const request = (method: string, url: string, body?: unknown) =>
  ({ method, routeOptions: { url }, body }) as FastifyRequest;
it("Generates the committed contract from every registered route without provider or database access", async () => {
  const document = await buildOpenApi();
  await SwaggerParser.validate(JSON.parse(JSON.stringify(document)), {
    resolve: { external: false },
    dereference: { circular: false },
  });
  expect(JSON.parse(await readFile("docs/openapi.json", "utf8"))).toEqual(document);
  const operations = Object.values(document.paths).flatMap((path) => Object.values(path));
  expect(operations).toHaveLength(apiOperations.length);
  expect(() => assertRouteInventory(apiOperations.slice(1))).toThrow("differ");
  expect(() =>
    assertRouteInventory([...apiOperations, { method: "POST", path: "/api/v1/undocumented" }]),
  ).toThrow("differ");
  const refs: string[] = [];
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (key === "$ref") refs.push(String(item));
      else visit(item);
    }
  }
  visit(document);
  for (const path of refs) {
    expect(path).toMatch(/^#\//);
    let target: unknown = document;
    for (const name of path.slice(2).split("/")) target = (target as Record<string, unknown>)[name];
    expect(target, path).toBeDefined();
  }
});
it("Binds financial request validation to its documented route and preserves strict inputs", () => {
  const path = "/api/v1/wallets/:id/transfers";
  const valid = { to: "0x0000000000000000000000000000000000000001", amount: "1000000" };
  expect(parseApiBody("transfer", request("POST", path, valid))).toEqual(valid);
  for (const changed of [
    { ...valid, amount: "0" },
    { ...valid, amount: "-1" },
    { ...valid, amount: String(2n ** 256n) },
    { ...valid, chainId: "1" },
    { ...valid, to: "invalid" },
  ])
    expect(() => parseApiBody("transfer", request("POST", path, changed))).toThrow();
  expect(() =>
    parseApiBody("organization", request("POST", path, { name: "Wrong route" })),
  ).toThrow("does not match");
  expect(() => parseApiBody("transfer", request("POST", "/api/v1/unknown", valid))).toThrow(
    "does not match",
  );
});
it("Documents authentication, exact upload content, version headers, and CSV polling separately", async () => {
  const { paths, components } = await buildOpenApi();
  const get = (path: string, method: string) =>
    paths[`/api/v1${path}`][method] as {
      security: unknown;
      requestBody: { content: Record<string, unknown> };
      parameters: { name: string }[];
      responses: Record<string, { content: Record<string, unknown> }>;
    };
  expect(get("/health", "get").security).toEqual([]);
  expect(get("/rpc/arc", "post").security).toEqual([]);
  expect(get("/organizations/{id}/reports", "get").security).toEqual([{ PrivyBearer: [] }]);
  expect(Object.keys(get("/uploads/{id}/ciphertext", "put").requestBody.content)).toEqual([
    "application/octet-stream",
  ]);
  expect(
    get("/funding-requests/{id}/authorize", "post").parameters.map((p: { name: string }) => p.name),
  ).toContain("If-Match");
  expect(get("/exports/{id}", "get").responses["200"].content).toHaveProperty("text/csv");
  expect(get("/exports/{id}", "get").responses["202"].content).toHaveProperty("application/json");
  expect(components.schemas.Request_fundingRequest).toMatchObject({
    additionalProperties: false,
    required: ["policyHash", "walletId", "authorizationWalletId"],
  });
});
it("Keeps bounded RPC batches and optional empty mutation bodies distinct", () => {
  const item = { jsonrpc: "2.0", id: 1, method: "eth_chainId" };
  expect(parseApiBody("arcRpc", request("POST", "/api/v1/rpc/arc", item))).toMatchObject({
    params: [],
  });
  expect(() => parseApiBody("arcRpc", request("POST", "/api/v1/rpc/arc", []))).toThrow();
  expect(() =>
    parseApiBody("arcRpc", request("POST", "/api/v1/rpc/arc", Array(11).fill(item))),
  ).toThrow();
  expect(parseApiBody("empty", request("POST", "/api/v1/wallets/sync"))).toEqual({});
  expect(() =>
    parseApiBody("empty", request("POST", "/api/v1/wallets/sync", { command: "send" })),
  ).toThrow();
});
