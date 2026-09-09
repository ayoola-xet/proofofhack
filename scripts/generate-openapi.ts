import { mkdir, readFile, writeFile } from "node:fs/promises";
import SwaggerParser from "@apidevtools/swagger-parser";
import { apiOperations } from "../services/api/src/api-contract.ts";
import { buildOpenApi } from "./openapi.ts";

const path = "docs/openapi.json";
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--check"))
  throw new Error("Use openapi:generate or openapi:check.");
const document = await buildOpenApi();
await SwaggerParser.validate(JSON.parse(JSON.stringify(document)), {
  resolve: { external: false },
  dereference: { circular: false },
});
const output = `${JSON.stringify(document, null, 2)}\n`;
const routesPath = "docs/API_ROUTES.md";
const routes = `# Implemented application routes

This file is generated with \`pnpm openapi:generate\`. The build checks it against the route inventory. Read [the OpenAPI contract](openapi.json) for input schemas and [API contract maintenance](API_CONTRACT_MAINTENANCE.md) for its limits.

All routes below use the API origin. The application returns private metadata with \`Cache-Control: no-store\`. A queued response does not prove a completed payment.

| Method and path | Operation | Caller | Success |
| --- | --- | --- | --- |
${apiOperations.map((operation) => `| \`${operation.method} ${operation.path}\` | ${operation.summary} | ${operation.access} | ${operation.status}${operation.id === "downloadExport" ? " CSV or 202 JSON" : ""} |`).join("\n")}

## Separate report download services

The researcher service serves \`GET /private/researcher/reports/:id\`. The report owner must authenticate. The organization service serves \`GET /private/organization/reports/:id\`. The caller needs current OWNER or REVIEWER membership and a final matching Paid event. Both services verify the report hash before delivery. These routes stream the report from separate services. They do not pass plaintext through the application API.

The verifier and report release services also have authenticated internal routes. They are not public application routes. See [Data and API specification](DATA_AND_API.md).
`;
if (args.includes("--check")) {
  if (
    (await readFile(path, "utf8").catch(() => "")) !== output ||
    (await readFile(routesPath, "utf8").catch(() => "")) !== routes
  ) {
    process.stderr.write(
      "The generated API contract is missing or changed. Run pnpm openapi:generate and review the result.\n",
    );
    process.exitCode = 1;
  } else
    process.stdout.write("The generated API contract matches the current schemas and routes.\n");
} else {
  await mkdir("docs", { recursive: true });
  await writeFile(path, output);
  await writeFile(routesPath, routes);
  process.stdout.write(`Generated ${path}. No database or provider access was used.\n`);
}
