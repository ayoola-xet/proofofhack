import type { requestSchemas } from "./request-schemas.ts";

export type ApiOperation = {
  method: "GET" | "POST" | "PATCH" | "PUT";
  path: string;
  id: string;
  summary: string;
  access: string;
  status: 200 | 201 | 202;
  body?: keyof typeof requestSchemas;
  optionalBody?: boolean;
  version?: boolean;
  pagination?: "uuid" | "hash" | "receipts";
  binary?: boolean;
};
const rows: ApiOperation[] = [];
function route(
  method: ApiOperation["method"],
  path: string,
  id: string,
  summary: string,
  access: string,
  status: ApiOperation["status"] = 200,
  extra: Partial<
    Pick<ApiOperation, "body" | "optionalBody" | "version" | "pagination" | "binary">
  > = {},
) {
  rows.push({ method, path: `/api/v1${path}`, id, summary, access, status, ...extra });
}
const user = "Authenticated user.",
  member = "Current organization member.",
  owner = "Current organization OWNER.",
  treasury = "Current organization OWNER or TREASURY.",
  reviewer = "Current organization OWNER or REVIEWER.";

route("GET", "/health", "health", "Read service availability", "Public.");
route("GET", "/me", "currentUser", "Read the current user and memberships", user);
route(
  "POST",
  "/organizations",
  "createOrganization",
  "Create an organization and its owner",
  user,
  201,
  { body: "organization" },
);
route(
  "GET",
  "/organizations/:id",
  "organization",
  "Read organization settings and members",
  member,
);
route(
  "POST",
  "/organizations/:id/members",
  "addMember",
  "Add an existing user to the organization",
  owner,
  201,
  { body: "member" },
);
route(
  "PATCH",
  "/organizations/:id/members/:userId",
  "updateMember",
  "Change a member role or status",
  owner,
  200,
  { body: "memberUpdate", version: true },
);
route(
  "POST",
  "/organizations/:id/coverage-policies",
  "createCoveragePolicy",
  "Approve a new coverage policy version",
  owner,
  201,
  { body: "coveragePolicy" },
);
route(
  "POST",
  "/organizations/:id/programs",
  "createProgram",
  "Create a bounty program",
  reviewer,
  201,
  { body: "program" },
);
route("GET", "/organizations/:id/programs", "programs", "List organization programs", member, 200, {
  pagination: "uuid",
});
route("GET", "/bounties", "bounties", "List funded fixture bounties", user, 200, {
  pagination: "hash",
});
route("GET", "/bounties/:id", "bounty", "Read confirmed bounty terms", user);
route(
  "GET",
  "/organizations/:id/coverage",
  "coverage",
  "Read coverage and observation metadata",
  member,
  200,
  { pagination: "uuid" },
);
route(
  "GET",
  "/organizations/:id/reports",
  "reports",
  "List organization report access states",
  reviewer,
  200,
  { pagination: "uuid" },
);
route("GET", "/wallets/me", "myWallets", "List the current user's wallet records", user);
route("GET", "/verifier-config", "verifierConfig", "Read public verifier configuration", user);
route(
  "POST",
  "/organizations/:id/report-key",
  "reportKey",
  "Create or read the organization report public key",
  owner,
  200,
  { body: "empty", optionalBody: true },
);
route(
  "POST",
  "/organizations/:id/fixture-manifests/prepare",
  "prepareManifest",
  "Prepare three synthetic cases from a fresh source reference",
  owner,
  201,
  { body: "prepareManifest" },
);
route(
  "POST",
  "/fixture-manifests/:id/sign",
  "signManifest",
  "Save and verify the owner's fixture manifest signature",
  owner,
  200,
  { body: "signature", version: true },
);
route(
  "GET",
  "/organizations/:id/fixture-manifests",
  "manifests",
  "List organization fixture manifests",
  member,
);
route(
  "POST",
  "/programs/:id/bounty-drafts",
  "createBountyDraft",
  "Create fixed bounty terms from a signed fixture manifest",
  reviewer,
  201,
  { body: "bountyDraft" },
);
route(
  "GET",
  "/organizations/:id/bounty-drafts",
  "bountyDrafts",
  "List organization bounty drafts",
  member,
);
route(
  "POST",
  "/bounty-drafts/:id/approve",
  "approveBountyDraft",
  "Approve the exact bounty policy hash",
  owner,
  200,
  { body: "policyHash", version: true },
);
route(
  "POST",
  "/organizations/:id/wallets",
  "createTreasuryWallet",
  "Queue organization wallet setup with an amount cap",
  owner,
  202,
  { body: "treasurySetup" },
);
route(
  "GET",
  "/organizations/:id/wallets",
  "treasuryWallets",
  "Read organization wallet setup records",
  treasury,
);
route(
  "GET",
  "/organizations/:id/wallets/:walletId/balance",
  "treasuryBalance",
  "Read the organization wallet test USDC balance",
  treasury,
);
route(
  "POST",
  "/bounty-drafts/:id/funding-requests",
  "requestFunding",
  "Prepare exact bounty funding for user confirmation",
  treasury,
  201,
  { body: "fundingRequest" },
);
route(
  "POST",
  "/funding-requests/:id/authorize",
  "authorizeFunding",
  "Verify a funding authorization and queue execution",
  treasury,
  202,
  { body: "signature", version: true },
);
route(
  "POST",
  "/funding-requests/:id/cancel",
  "cancelFunding",
  "Reject an unsigned funding request",
  "The original requester.",
  200,
  { body: "empty", optionalBody: true },
);
route(
  "GET",
  "/organizations/:id/funding-requests",
  "fundingRequests",
  "Read organization funding requests",
  "Current organization OWNER, TREASURY, or REVIEWER.",
);
route(
  "POST",
  "/funding-requests/:id/retry",
  "retryFunding",
  "Queue reconciliation of an existing funding request",
  treasury,
  202,
  { body: "empty", optionalBody: true },
);
route(
  "POST",
  "/bounties/:id/uploads",
  "prepareUpload",
  "Create a claim and encrypted upload destination",
  "Authenticated researcher with a currently linked claimant wallet.",
  201,
  { body: "upload" },
);
route(
  "PUT",
  "/uploads/:id/ciphertext",
  "uploadCiphertext",
  "Save and verify bounded ciphertext bytes",
  "The upload owner before upload expiry.",
  200,
  { binary: true },
);
route("GET", "/claims/me", "myClaims", "List the researcher's claims and report metadata", user);
route("GET", "/coverage/sources", "coverageSources", "List configured public vault sources", user);
route(
  "POST",
  "/organizations/:id/vaults",
  "registerVault",
  "Register an allowlisted public vault source",
  reviewer,
  201,
  { body: "vault" },
);
route(
  "GET",
  "/organizations/:id/coverage-policies",
  "coveragePolicies",
  "List approved coverage policy versions",
  member,
);
route(
  "POST",
  "/organizations/:id/coverage/refresh",
  "refreshCoverage",
  "Queue a live Graph coverage refresh",
  member,
  202,
  { body: "empty", optionalBody: true },
);
route(
  "GET",
  "/organizations/:id/recommendations",
  "recommendations",
  "List saved coverage recommendations",
  member,
);
route(
  "GET",
  "/recommendations/:id",
  "recommendation",
  "Read a saved recommendation and current expiry state",
  member,
);
route("GET", "/organizations/:id/controllers", "controllers", "List budget controllers", member);
route(
  "POST",
  "/organizations/:id/controllers",
  "registerController",
  "Verify and register an existing controller deployment",
  owner,
  201,
  { body: "controller" },
);
route(
  "POST",
  "/controllers/:id/refresh",
  "refreshController",
  "Refresh the final controller state",
  member,
  200,
  { body: "empty", optionalBody: true },
);
route(
  "POST",
  "/controllers/:id/approvals/sync",
  "syncControllerApproval",
  "Verify and save the final approval for an exact policy",
  treasury,
  200,
  { body: "syncApproval" },
);
route(
  "GET",
  "/controllers/:id/approvals",
  "controllerApprovals",
  "List the controller's verified policy approvals",
  member,
);
route(
  "POST",
  "/organizations/:id/allocations",
  "requestAllocation",
  "Queue a bounded allocation from a recommendation",
  treasury,
  202,
  { body: "allocation" },
);
route(
  "GET",
  "/organizations/:id/allocations",
  "allocations",
  "List organization allocation actions",
  member,
);
route(
  "GET",
  "/allocations/:id",
  "allocation",
  "Read one allocation action and its failure state",
  member,
);
route(
  "POST",
  "/allocations/:id/retry",
  "retryAllocation",
  "Queue an existing allocation for reconciliation",
  treasury,
  202,
  { body: "empty", optionalBody: true },
);
route(
  "POST",
  "/controllers/:id/owner-requests",
  "requestOwnerAction",
  "Prepare an exact controller owner action",
  owner,
  201,
  { body: "ownerRequest" },
);
route(
  "POST",
  "/owner-requests/:id/authorize",
  "authorizeOwnerAction",
  "Verify the owner's signature and queue execution",
  owner,
  202,
  { body: "signature", version: true },
);
route(
  "GET",
  "/controllers/:id/owner-requests",
  "ownerRequests",
  "List controller owner requests",
  member,
);
route(
  "POST",
  "/owner-requests/:id/cancel",
  "cancelOwnerAction",
  "Reject an unsigned owner request",
  "The original requester.",
  200,
  { body: "empty", optionalBody: true },
);
route(
  "POST",
  "/owner-requests/:id/retry",
  "retryOwnerAction",
  "Queue an existing owner request for reconciliation",
  owner,
  202,
  { body: "empty", optionalBody: true },
);
route("GET", "/assistant/config", "assistantConfig", "Read model availability and scope", user);
route(
  "POST",
  "/organizations/:id/assistant-runs",
  "createAssistantRun",
  "Queue a coverage explanation from an immutable snapshot",
  member,
  202,
  { body: "assistantQuestion" },
);
route(
  "GET",
  "/organizations/:id/assistant-runs",
  "assistantRuns",
  "List saved coverage explanations",
  member,
);
route(
  "GET",
  "/assistant-runs/:id",
  "assistantRun",
  "Read an explanation with source and validation state",
  member,
);
route(
  "POST",
  "/wallets/sync",
  "syncWallets",
  "Refresh the user's currently linked Privy wallets",
  user,
  200,
  { body: "empty", optionalBody: true },
);
route(
  "GET",
  "/wallets/:id/balance",
  "walletBalance",
  "Read one user's test USDC balance without double counting",
  "The wallet owner.",
);
route(
  "POST",
  "/wallets/:id/transfers",
  "prepareTransfer",
  "Prepare a test USDC transfer for Privy confirmation",
  "The currently linked wallet owner.",
  201,
  { body: "transfer" },
);
route(
  "GET",
  "/wallets/:id/transfers",
  "walletTransfers",
  "List the user's transfer intents",
  "The wallet owner.",
);
route(
  "POST",
  "/transfers/:id/broadcast",
  "recordTransfer",
  "Check the exact signed transfer and save its broadcast state",
  "The currently linked wallet owner.",
  200,
  { body: "transactionHash" },
);
route(
  "GET",
  "/organizations/:id/recovery",
  "recovery",
  "List bounty expiry and refund recovery states",
  treasury,
  200,
  { pagination: "hash" },
);
route(
  "POST",
  "/bounties/:id/recovery/retry",
  "retryRecovery",
  "Queue bounded bounty recovery",
  treasury,
  202,
  { body: "empty", optionalBody: true },
);
route(
  "POST",
  "/bounties/:id/recovery-receipts",
  "reconcileRecovery",
  "Verify and project a final recovery receipt",
  treasury,
  200,
  { body: "transactionHash" },
);
for (const [base, prefix, access] of [
  ["/organizations/:id", "organization", treasury],
  ["/me", "personal", "The receipt claimant or export requester."],
] as const) {
  route(
    "GET",
    `${base}/receipts`,
    `${prefix}Receipts`,
    "List final financial receipts",
    access,
    200,
    { pagination: "receipts" },
  );
  route(
    "POST",
    `${base}/receipt-exports`,
    `${prefix}Export`,
    "Queue a saved receipt export with chain validation",
    access,
    202,
    { body: "receiptFilters", optionalBody: true },
  );
  route(
    "GET",
    `${base}/receipt-exports`,
    `${prefix}Exports`,
    "List the current user's saved exports",
    access,
  );
}
route(
  "GET",
  "/exports/:id/status",
  "exportStatus",
  "Read saved export progress and content hash",
  "The export requester. Organization exports also require current OWNER or TREASURY membership.",
);
route(
  "GET",
  "/exports/:id",
  "downloadExport",
  "Download verified CSV or read pending export metadata",
  "The export requester. Organization exports also require current OWNER or TREASURY membership.",
);
route(
  "POST",
  "/rpc/arc",
  "arcRpc",
  "Proxy bounded Arc wallet RPC calls",
  "Public. Reads are allowlisted. Signed sends require an exact saved Privy transfer intent.",
  200,
  { body: "arcRpc" },
);

export const apiOperations: readonly ApiOperation[] = rows;
export function apiOperation(method: string, path: string) {
  return apiOperations.find((row) => row.method === method && row.path === path);
}
