import { createRemoteJWKSet } from "jose";
import { z } from "zod";
import { PrivyAuthProvider } from "../../../services/api/src/auth.ts";
export function configuredPrivyAuth() {
  const id = z
    .string()
    .regex(/^[a-z0-9]+$/)
    .parse(process.env.PRIVY_APP_ID);
  return new PrivyAuthProvider(
    id,
    process.env.PRIVY_VERIFICATION_KEY ||
      createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${id}/jwks.json`)),
  );
}
