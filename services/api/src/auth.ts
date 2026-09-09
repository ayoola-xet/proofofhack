import { createHash, timingSafeEqual } from "node:crypto";
import { verifyAccessToken } from "@privy-io/node";
import type { JWTVerifyGetKey } from "jose";
import { DomainError } from "../../../packages/domain/src/index.ts";

export interface SessionIdentity {
  subject: string;
  displayName: string;
}
export interface AuthProvider {
  verify(token: string): Promise<SessionIdentity>;
}

export class PrivyAuthProvider implements AuthProvider {
  constructor(
    private appId: string,
    private verificationKey: string | JWTVerifyGetKey,
  ) {}
  async verify(token: string): Promise<SessionIdentity> {
    try {
      const session = await verifyAccessToken({
        access_token: token,
        app_id: this.appId,
        verification_key: this.verificationKey,
      });
      if (!session.user_id.startsWith("did:privy:")) throw new Error("Invalid subject.");
      return { subject: session.user_id, displayName: "ProofOfHack member" };
    } catch {
      throw new DomainError("UNAUTHENTICATED", "Sign in again.", 401);
    }
  }
}

// This provider is available only in an explicitly selected local environment.
export class LocalAuthProvider implements AuthProvider {
  constructor(
    private entries: { token: string; subject: string; displayName: string }[],
    appEnv: string,
  ) {
    if (appEnv !== "local") throw new Error("Local authentication requires APP_ENV=local.");
    if (entries.some((entry) => entry.token.length < 32 || !entry.subject.startsWith("local:")))
      throw new Error("Use separate local identities and random tokens.");
  }
  async verify(token: string): Promise<SessionIdentity> {
    const digest = createHash("sha256").update(token).digest();
    const entry = this.entries.find((item) =>
      timingSafeEqual(digest, createHash("sha256").update(item.token).digest()),
    );
    if (!entry) throw new DomainError("UNAUTHENTICATED", "Sign in again.", 401);
    return { subject: entry.subject, displayName: entry.displayName };
  }
}
