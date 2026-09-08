# AI use record

Updated: 8 September 2026

## Development assistance

Codex generates and edits application code, tests, specifications, and setup scripts in this repository. It also operates authorized provider setup and testnet workflows. Git history records the implementation changes. Human approval of an account or transaction is recorded separately when the user supplies it.

This record does not claim an independent human audit. Automated tests provide evidence for their stated cases only.

## Product model

The coverage assistant uses the OpenAI Responses API. Configure `MODEL_API_KEY` and `MODEL_ID` in the worker environment. The model must support Structured Outputs. The model ID is saved for each request. The provider response model and token usage are saved when available.

The request uses a strict JSON schema, no tools, and `store: false`. See [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) and [Responses API](https://developers.openai.com/api/reference/cli/resources/responses/methods/create). This setting is not a claim about zero retention by every provider system.

The application supplies a question and a bounded coverage snapshot. It copies only known source fields. It excludes external labels and descriptions. It excludes report contents, fixture files, wallet secrets, and organization names. Source data remains untrusted input.

The model explains the fixed calculation. It does not calculate qualification, choose a reward, sign an assessment, transfer funds, or grant report access. The server requires exact decision fields and exact source references. The interface shows generated prose separately from checked amounts and source details.

Generated prose still needs review. A valid schema does not prove that every sentence is correct. Coverage does not establish vault security, insurance, or a vulnerability.

## Verification state

Run `pnpm test:ai` for local coverage and assistant checks. The assistant integration tests use a simulated provider. The HTTP adapter test inspects the request and a simulated Responses API response.

The live model test is not complete. Both model configuration values are missing from the current local environment. Do not use local test output as evidence of a live AI integration.

Before submission, complete these live checks:

1. Ask which registered vaults lack funded coverage.
2. Compare every citation with the displayed Graph source record.
3. Change a confirmed funding record or source observation. Ask again.
4. Confirm that stale data produces an abstention.
5. Ask for a payout change and private evidence. Confirm that the assistant has no action or access for either request.
6. Save the model ID, request ID, input hash, source references, result, and token usage in sanitized evidence.

Do not publish private questions, credentials, fixture files, or report contents in the evidence package.

## Team contribution record

The user selects the product direction and the three sponsors. The user authorizes account setup and testnet work. Codex creates the implementation, tests, documentation, and provider setup changes recorded in Git. This record does not attribute that code to a human team member.

The named contribution record for other team members remains pending. Record actual design, code review, testing, or presentation work before submission. The event requires AI attribution and meaningful team contributions. It also requires the specification, prompts, and planning artifacts for a specification-driven build. See [the current submission rules](https://ethglobal.com/events/ethonline2026/info/details). Do not claim that AI use alone establishes eligibility.
