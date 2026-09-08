# Implemented application routes

This file is generated with `pnpm openapi:generate`. The build checks it against the route inventory. Read [the OpenAPI contract](openapi.json) for input schemas and [API contract maintenance](API_CONTRACT_MAINTENANCE.md) for its limits.

All routes below use the API origin. The application returns private metadata with `Cache-Control: no-store`. A queued response does not prove a completed payment.

| Method and path | Operation | Caller | Success |
| --- | --- | --- | --- |
| `GET /api/v1/health` | Read service availability | Public. | 200 |
| `GET /api/v1/me` | Read the current user and memberships | Authenticated user. | 200 |
| `POST /api/v1/organizations` | Create an organization and its owner | Authenticated user. | 201 |
| `GET /api/v1/organizations/:id` | Read organization settings and members | Current organization member. | 200 |
| `POST /api/v1/organizations/:id/members` | Add an existing user to the organization | Current organization OWNER. | 201 |
| `PATCH /api/v1/organizations/:id/members/:userId` | Change a member role or status | Current organization OWNER. | 200 |
| `POST /api/v1/organizations/:id/coverage-policies` | Approve a new coverage policy version | Current organization OWNER. | 201 |
| `POST /api/v1/organizations/:id/programs` | Create a bounty program | Current organization OWNER or REVIEWER. | 201 |
| `GET /api/v1/organizations/:id/programs` | List organization programs | Current organization member. | 200 |
| `GET /api/v1/bounties` | List funded fixture bounties | Authenticated user. | 200 |
| `GET /api/v1/bounties/:id` | Read confirmed bounty terms | Authenticated user. | 200 |
| `GET /api/v1/organizations/:id/coverage` | Read coverage and observation metadata | Current organization member. | 200 |
| `GET /api/v1/organizations/:id/reports` | List organization report access states | Current organization OWNER or REVIEWER. | 200 |
| `GET /api/v1/wallets/me` | List the current user's wallet records | Authenticated user. | 200 |
| `GET /api/v1/verifier-config` | Read public verifier configuration | Authenticated user. | 200 |
| `POST /api/v1/organizations/:id/report-key` | Create or read the organization report public key | Current organization OWNER. | 200 |
| `POST /api/v1/organizations/:id/fixture-manifests/prepare` | Prepare three synthetic cases from a fresh source reference | Current organization OWNER. | 201 |
| `POST /api/v1/fixture-manifests/:id/sign` | Save and verify the owner's fixture manifest signature | Current organization OWNER. | 200 |
| `GET /api/v1/organizations/:id/fixture-manifests` | List organization fixture manifests | Current organization member. | 200 |
| `POST /api/v1/programs/:id/bounty-drafts` | Create fixed bounty terms from a signed fixture manifest | Current organization OWNER or REVIEWER. | 201 |
| `GET /api/v1/organizations/:id/bounty-drafts` | List organization bounty drafts | Current organization member. | 200 |
| `POST /api/v1/bounty-drafts/:id/approve` | Approve the exact bounty policy hash | Current organization OWNER. | 200 |
| `POST /api/v1/organizations/:id/wallets` | Queue organization wallet setup with an amount cap | Current organization OWNER. | 202 |
| `GET /api/v1/organizations/:id/wallets` | Read organization wallet setup records | Current organization OWNER or TREASURY. | 200 |
| `GET /api/v1/organizations/:id/wallets/:walletId/balance` | Read the organization wallet test USDC balance | Current organization OWNER or TREASURY. | 200 |
| `POST /api/v1/bounty-drafts/:id/funding-requests` | Prepare exact bounty funding for user confirmation | Current organization OWNER or TREASURY. | 201 |
| `POST /api/v1/funding-requests/:id/authorize` | Verify a funding authorization and queue execution | Current organization OWNER or TREASURY. | 202 |
| `POST /api/v1/funding-requests/:id/cancel` | Reject an unsigned funding request | The original requester. | 200 |
| `GET /api/v1/organizations/:id/funding-requests` | Read organization funding requests | Current organization OWNER, TREASURY, or REVIEWER. | 200 |
| `POST /api/v1/funding-requests/:id/retry` | Queue reconciliation of an existing funding request | Current organization OWNER or TREASURY. | 202 |
| `POST /api/v1/bounties/:id/uploads` | Create a claim and encrypted upload destination | Authenticated researcher with a currently linked claimant wallet. | 201 |
| `PUT /api/v1/uploads/:id/ciphertext` | Save and verify bounded ciphertext bytes | The upload owner before upload expiry. | 200 |
| `GET /api/v1/claims/me` | List the researcher's claims and report metadata | Authenticated user. | 200 |
| `GET /api/v1/coverage/sources` | List configured public vault sources | Authenticated user. | 200 |
| `POST /api/v1/organizations/:id/vaults` | Register an allowlisted public vault source | Current organization OWNER or REVIEWER. | 201 |
| `GET /api/v1/organizations/:id/coverage-policies` | List approved coverage policy versions | Current organization member. | 200 |
| `POST /api/v1/organizations/:id/coverage/refresh` | Queue a live Graph coverage refresh | Current organization member. | 202 |
| `GET /api/v1/organizations/:id/recommendations` | List saved coverage recommendations | Current organization member. | 200 |
| `GET /api/v1/recommendations/:id` | Read a saved recommendation and current expiry state | Current organization member. | 200 |
| `GET /api/v1/organizations/:id/controllers` | List budget controllers | Current organization member. | 200 |
| `POST /api/v1/organizations/:id/controllers` | Verify and register an existing controller deployment | Current organization OWNER. | 201 |
| `POST /api/v1/controllers/:id/refresh` | Refresh the final controller state | Current organization member. | 200 |
| `POST /api/v1/controllers/:id/approvals/sync` | Verify and save the final approval for an exact policy | Current organization OWNER or TREASURY. | 200 |
| `GET /api/v1/controllers/:id/approvals` | List the controller's verified policy approvals | Current organization member. | 200 |
| `POST /api/v1/organizations/:id/allocations` | Queue a bounded allocation from a recommendation | Current organization OWNER or TREASURY. | 202 |
| `GET /api/v1/organizations/:id/allocations` | List organization allocation actions | Current organization member. | 200 |
| `GET /api/v1/allocations/:id` | Read one allocation action and its failure state | Current organization member. | 200 |
| `POST /api/v1/allocations/:id/retry` | Queue an existing allocation for reconciliation | Current organization OWNER or TREASURY. | 202 |
| `POST /api/v1/controllers/:id/owner-requests` | Prepare an exact controller owner action | Current organization OWNER. | 201 |
| `POST /api/v1/owner-requests/:id/authorize` | Verify the owner's signature and queue execution | Current organization OWNER. | 202 |
| `GET /api/v1/controllers/:id/owner-requests` | List controller owner requests | Current organization member. | 200 |
| `POST /api/v1/owner-requests/:id/cancel` | Reject an unsigned owner request | The original requester. | 200 |
| `POST /api/v1/owner-requests/:id/retry` | Queue an existing owner request for reconciliation | Current organization OWNER. | 202 |
| `GET /api/v1/assistant/config` | Read model availability and scope | Authenticated user. | 200 |
| `POST /api/v1/organizations/:id/assistant-runs` | Queue a coverage explanation from an immutable snapshot | Current organization member. | 202 |
| `GET /api/v1/organizations/:id/assistant-runs` | List saved coverage explanations | Current organization member. | 200 |
| `GET /api/v1/assistant-runs/:id` | Read an explanation with source and validation state | Current organization member. | 200 |
| `POST /api/v1/wallets/sync` | Refresh the user's currently linked Privy wallets | Authenticated user. | 200 |
| `GET /api/v1/wallets/:id/balance` | Read one user's test USDC balance without double counting | The wallet owner. | 200 |
| `POST /api/v1/wallets/:id/transfers` | Prepare a test USDC transfer for Privy confirmation | The currently linked wallet owner. | 201 |
| `GET /api/v1/wallets/:id/transfers` | List the user's transfer intents | The wallet owner. | 200 |
| `POST /api/v1/transfers/:id/broadcast` | Check the exact signed transfer and save its broadcast state | The currently linked wallet owner. | 200 |
| `GET /api/v1/organizations/:id/recovery` | List bounty expiry and refund recovery states | Current organization OWNER or TREASURY. | 200 |
| `POST /api/v1/bounties/:id/recovery/retry` | Queue bounded bounty recovery | Current organization OWNER or TREASURY. | 202 |
| `POST /api/v1/bounties/:id/recovery-receipts` | Verify and project a final recovery receipt | Current organization OWNER or TREASURY. | 200 |
| `GET /api/v1/organizations/:id/receipts` | List final financial receipts | Current organization OWNER or TREASURY. | 200 |
| `POST /api/v1/organizations/:id/receipt-exports` | Queue a saved receipt export with chain validation | Current organization OWNER or TREASURY. | 202 |
| `GET /api/v1/organizations/:id/receipt-exports` | List the current user's saved exports | Current organization OWNER or TREASURY. | 200 |
| `GET /api/v1/me/receipts` | List final financial receipts | The receipt claimant or export requester. | 200 |
| `POST /api/v1/me/receipt-exports` | Queue a saved receipt export with chain validation | The receipt claimant or export requester. | 202 |
| `GET /api/v1/me/receipt-exports` | List the current user's saved exports | The receipt claimant or export requester. | 200 |
| `GET /api/v1/exports/:id/status` | Read saved export progress and content hash | The export requester. Organization exports also require current OWNER or TREASURY membership. | 200 |
| `GET /api/v1/exports/:id` | Download verified CSV or read pending export metadata | The export requester. Organization exports also require current OWNER or TREASURY membership. | 200 CSV or 202 JSON |
| `POST /api/v1/rpc/arc` | Proxy bounded Arc wallet RPC calls | Public. Reads are allowlisted. Signed sends require an exact saved Privy transfer intent. | 200 |

## Separate report download services

The researcher service serves `GET /private/researcher/reports/:id`. The report owner must authenticate. The organization service serves `GET /private/organization/reports/:id`. The caller needs current OWNER or REVIEWER membership and a final matching Paid event. Both services verify the report hash before delivery. These routes stream the report from separate services. They do not pass plaintext through the application API.

The verifier and report release services also have authenticated internal routes. They are not public application routes. See [Data and API specification](DATA_AND_API.md).
