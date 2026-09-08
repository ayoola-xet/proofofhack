# API contract maintenance

The [OpenAPI 3.1.1 contract](openapi.json) describes the implemented application API. The [route table](API_ROUTES.md) lists every registered application operation. The original design tables remain in [Data and API specification](DATA_AND_API.md). They describe the design scope. They are not the current route directory.

## Generation and checks

Run `pnpm openapi:generate` after an API input or route change. Review and commit both generated files. Run `pnpm openapi:check` to validate the OpenAPI document and compare its exact bytes with the current generator output.

`pnpm build` runs this check before the package builds. A missing route entry, changed schema, invalid document, or changed generated file fails the build. The existing CI workflow uses this root build command.

Generation starts the Fastify application without listening on a port. It records the actual routes. Database and authentication adapters throw if generation tries to use them. No provider request, account, database, or secret is required. The OpenAPI validator cannot resolve external references.

## Input source

`services/api/src/request-schemas.ts` contains the implemented JSON input schemas, path schemas, version header, and idempotency header. The original validation rules remain in these schemas. Financial and authorization inputs reject unknown fields.

`services/api/src/api-contract.ts` assigns each route its input schema, caller rules, response status, and pagination mode. Each JSON mutation uses `parseApiBody`. This function checks the route assignment before it parses the request. A handler cannot silently use a different named schema.

Zod converts the schemas to JSON Schema. It uses the input side of transforms. For example, an EVM address can have mixed-case hex at input and lowercase hex in storage. The generator uses the parsed number shape for the page limit. It keeps hash cursors as hex strings.

Some rules require code and current state. Examples include integer-string limits, a nonzero reward, one selected refund destination, current membership, source freshness, and the exact chain policy. JSON Schema does not replace these checks. The contract describes these limits. The API and integration tests enforce them.

## Wire behavior

All application routes require a Privy access token except health and the bounded Arc RPC route. RPC reads use an allowlist. Signed sends must match a saved user transfer intent. A JSON-RPC error can use HTTP 200.

JSON mutations require `Idempotency-Key`. Ciphertext upload uses its prepared upload ID and exact hash for repeat handling. It accepts raw `application/octet-stream` bytes. It does not accept a plaintext fixture body. Versioned approval and authorization routes also require `If-Match`.

A receipt download returns CSV with HTTP 200 when ready. It returns progress metadata with HTTP 202 otherwise. The CSV response includes `X-Content-SHA256`. A client must verify that hash before it saves the file.

Private report downloads use separate researcher and organization services. Internal admission, assessment, report-key, and report-release operations use service identity tokens. They are outside this application OpenAPI document. They must not be routed to the public application API.

## Current limits

The contract provides complete application route coverage and shared request validation. It defines response schemas for health, the current user, bounty terms, upload metadata, export metadata, RPC results, and list envelopes. Other resource projections remain open JSON objects. These response types do not yet provide a full client data model. Do not infer missing fields from a successful schema check.

The original design includes route names that have different implemented names or grouped workflows. Route parity still requires review against the release requirements. A generated route inventory does not prove that every original design operation is delivered. It also does not prove live provider access, private report isolation, or submission readiness.

## References

- [Zod JSON Schema conversion](https://zod.dev/json-schema) defines input and output conversion.
- [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html) defines the document format.
- [Swagger Parser validation](https://apidevtools.com/swagger-parser/) defines the independent document check.
