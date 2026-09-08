import type { FastifyRequest } from "fastify";
import type { z } from "zod";
import { apiOperation } from "./api-contract.ts";
import { requestSchemas } from "./request-schemas.ts";

export function parseApiBody<K extends keyof typeof requestSchemas>(
  key: K,
  request: FastifyRequest,
): z.output<(typeof requestSchemas)[K]> {
  const operation = apiOperation(request.method, request.routeOptions.url ?? "");
  if (operation?.body !== key)
    throw new Error("The request schema does not match its API operation.");
  return requestSchemas[key].parse(
    operation.optionalBody ? (request.body ?? {}) : request.body,
  ) as z.output<(typeof requestSchemas)[K]>;
}
