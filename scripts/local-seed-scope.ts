export class LocalSeedError extends Error {}

export function localSeedScope(env: Record<string, string | undefined>) {
  if (env.APP_ENV !== "local") throw new LocalSeedError("Seed setup requires APP_ENV=local.");
  let rpc: URL, database: URL;
  try {
    rpc = new URL(env.LOCAL_RPC_URL ?? "");
    database = new URL(env.LOCAL_SEED_DATABASE_URL ?? "");
  } catch {
    throw new LocalSeedError("Set LOCAL_RPC_URL and LOCAL_SEED_DATABASE_URL explicitly.");
  }
  const loopback = (host: string) => ["127.0.0.1", "[::1]"].includes(host);
  if (
    rpc.protocol !== "http:" ||
    !loopback(rpc.hostname) ||
    !rpc.port ||
    rpc.username ||
    rpc.password ||
    rpc.pathname !== "/" ||
    rpc.search ||
    rpc.hash
  )
    throw new LocalSeedError(
      "Use a loopback HTTP Anvil URL with an explicit port and no extra fields.",
    );
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !loopback(database.hostname) ||
    !database.port ||
    database.search ||
    database.hash ||
    !/^\/proofofhack_seed_[a-z0-9_]{1,32}$/.test(database.pathname)
  )
    throw new LocalSeedError(
      "Use a loopback PostgreSQL URL with a new proofofhack_seed_ database name.",
    );
  return { rpc: rpc.toString(), database: database.toString(), name: database.pathname.slice(1) };
}
