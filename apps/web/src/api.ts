import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function useApi() {
  const { getAccessToken } = usePrivy();
  return useCallback(
    async <T>(
      path: string,
      options: {
        method?: string;
        body?: unknown;
        version?: number;
        key?: string;
        signal?: AbortSignal;
      } = {},
    ): Promise<T> => {
      const token = await getAccessToken();
      if (!token) throw new ApiError("UNAUTHENTICATED", "Sign in again.");
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (options.body !== undefined) headers["Content-Type"] = "application/json";
      if (options.method && options.method !== "GET")
        headers["Idempotency-Key"] = options.key ?? crypto.randomUUID();
      if (options.version) headers["If-Match"] = String(options.version);
      const result = await fetch(`/api/v1${path}`, {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      });
      const json = await result.json();
      if (!result.ok)
        throw new ApiError(
          json.error?.code ?? "SERVICE_ERROR",
          json.error?.message ?? "The service is not available.",
        );
      return json;
    },
    [getAccessToken],
  );
}
export function useResource<T>(path: string | null, options?: { intervalMs?: number }) {
  const api = useApi();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const intervalMs = options?.intervalMs;
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    if (!path) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api<T>(path, { signal: controller.signal })
      .then(setData)
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, path, revision]);
  // Polls silently in the background: keeps the last good data on screen and
  // does not touch loading/error, so live updates never flicker the list.
  useEffect(() => {
    if (!path || !intervalMs) return;
    const timer = setInterval(() => {
      api<T>(path).then(setData).catch(() => {});
    }, intervalMs);
    return () => clearInterval(timer);
  }, [api, path, intervalMs]);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  return { data, error, loading, refresh };
}
export type Membership = { organization_id: string; name: string; role: string; version: number };
export type Me = {
  user: { id: string; displayName: string };
  memberships: Membership[];
  wallets: Wallet[];
};
export type Wallet = { id: string; provider: string; address: string; chain_id: string };
