import { access } from "node:fs/promises";

const endpoints: Record<string, [number, string, number][]> = {
  api: [[4187, "/api/v1/health", 200]],
  verifier: [
    [4191, "/health", 200],
    [4192, "/private/researcher/reports/00000000-0000-4000-8000-000000000000", 401],
  ],
  reports: [
    [4194, "/health", 200],
    [4193, "/private/organization/reports/00000000-0000-4000-8000-000000000000", 401],
  ],
};
const role = process.argv[2];
try {
  await access("/tmp/ready");
  for (const [port, path, status] of endpoints[role] ?? []) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (response.status !== status) throw new Error("Unexpected health response.");
  }
} catch {
  process.exitCode = 1;
}
