import { defineConfig } from "vitest/config";

const integration = [
  "tests/api.test.ts",
  "tests/assistant.test.ts",
  "tests/bounty-drafts.test.ts",
  "tests/budget.test.ts",
  "tests/claim-journey.test.ts",
  "tests/coverage-persistence.test.ts",
  "tests/funding.test.ts",
  "tests/owner-controls.test.ts",
  "tests/recovery.test.ts",
  "tests/report-access.test.ts",
  "tests/retention.test.ts",
  "tests/receipt-exports.test.ts",
  "tests/treasury.test.ts",
];
export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["tests/*.test.ts"], exclude: integration } },
      { test: { name: "integration", include: integration } },
    ],
  },
});
