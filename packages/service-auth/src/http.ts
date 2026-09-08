import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { decodeJwt } from "jose";
import { z } from "zod";
import { DomainError } from "../../domain/src/index.ts";
import { serviceToken, verifyServiceToken } from "./index.ts";
export function internalService(name: string, allowedCallers: Record<string, string>) {
  const app = Fastify({ logger: false, bodyLimit: 300000, genReqId: () => randomUUID() });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff");
    if (request.url === "/health") return;
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer "))
      throw new DomainError("UNAUTHENTICATED", "Service authentication is required.", 401);
    const token = header.slice(7);
    let issuer: string | undefined;
    try {
      issuer = decodeJwt(token).iss;
    } catch {}
    if (!issuer || !allowedCallers[issuer])
      throw new DomainError("UNAUTHENTICATED", "Unknown service identity.", 401);
    await verifyServiceToken(token, allowedCallers[issuer], issuer, name);
    request.headers["x-verified-service"] = issuer;
  });
  app.setErrorHandler((error: Error, request, reply) => {
    const code =
      error instanceof DomainError
        ? error.code
        : error instanceof z.ZodError
          ? "INVALID_INPUT"
          : "SERVICE_ERROR";
    const status =
      error instanceof DomainError ? error.status : error instanceof z.ZodError ? 400 : 503;
    reply.code(status).send({
      error: {
        code,
        message:
          error instanceof DomainError
            ? error.message
            : "The service cannot complete this request.",
        requestId: request.id,
      },
    });
  });
  app.get("/health", async () => ({ status: "available", service: name }));
  return app;
}
export class InternalClient {
  constructor(
    private baseUrl: string,
    private issuer: string,
    private audience: string,
    private privateKey: string,
  ) {
    const url = new URL(baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error("Invalid service URL.");
  }
  async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    if (!path.startsWith("/internal/") || path.includes(".."))
      throw new Error("Invalid service path.");
    const token = await serviceToken(this.privateKey, this.issuer, this.audience);
    const response = await fetch(new URL(path, this.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      if (response.status === 422 && body?.error?.code === "INVALID_FIXTURE")
        throw new DomainError(
          "INVALID_FIXTURE",
          "The encrypted file is not a valid signed fixture case.",
          422,
        );
      throw new DomainError(
        "INTERNAL_SERVICE_UNAVAILABLE",
        "The confidential service cannot complete this request.",
        503,
      );
    }
    return response.json() as Promise<T>;
  }
}
