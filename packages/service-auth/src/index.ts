import { randomUUID } from "node:crypto";
import { importPKCS8, importSPKI, jwtVerify, SignJWT } from "jose";
import { DomainError } from "../../domain/src/index.ts";

export async function serviceToken(privateKey: string, issuer: string, audience: string) {
  const key = await importPKCS8(privateKey, "EdDSA");
  return new SignJWT({})
    .setProtectedHeader({ alg: "EdDSA" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("60s")
    .setJti(randomUUID())
    .sign(key);
}
export async function verifyServiceToken(
  token: string,
  publicKey: string,
  issuer: string,
  audience: string,
) {
  try {
    const key = await importSPKI(publicKey, "EdDSA");
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["EdDSA"],
      issuer,
      audience,
      maxTokenAge: "60s",
      clockTolerance: 2,
    });
    if (!payload.jti || !payload.exp || !payload.iat || payload.exp - payload.iat > 60)
      throw new Error("Invalid service token lifetime.");
    return payload;
  } catch {
    throw new DomainError("UNAUTHENTICATED", "Service authentication failed.", 401);
  }
}
