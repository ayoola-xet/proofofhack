import type { PoolClient } from "pg";

export const ciphertextLock = "proofofhack:ciphertext-maintenance:v1";

// Call inside the transaction that creates a ciphertext object and its metadata.
export async function protectCiphertextWrite(c: Pick<PoolClient, "query">) {
  await c.query("select pg_advisory_xact_lock_shared(hashtextextended($1,0))", [ciphertextLock]);
}
