# Coverage model setup

The coverage assistant explains fixed calculations from live Graph records. The model cannot set a reward, approve a policy, send funds, read private evidence, or release a report. The server checks each returned decision and source reference before it accepts the answer.

## Service configuration

Set these values in the API service environment:

```dotenv
ASSISTANT_ENABLED=true
MODEL_ID=your-enabled-model-id
```

Set the same values in the worker service environment. Add `MODEL_API_KEY` only to the worker. Use an OpenAI API key with permission to create Responses API requests. Keep the key in the ignored local environment file or the worker's deployment secret file. Do not put it in browser configuration or a web build argument.

The worker requires a key when the assistant is explicitly enabled. The API needs only the enable flag and model ID. Set `ASSISTANT_ENABLED=false` to disable the assistant in each service. An absent flag preserves the existing local configuration, which enables the assistant when a model ID and key are present.

The selected model must support the Responses API and Structured Outputs. The adapter sends a strict JSON schema through `text.format`. It sets `store: false` and supplies no tools. See [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs). These request settings do not establish a separate contractual data-retention policy.

## Live check

1. Configure a funded API account and an enabled model.
2. Restart the API and worker with the matching model ID.
3. Open Vault coverage in the signed-in app.
4. Refresh the registered vault data.
5. Ask which registered vaults need funded coverage.
6. Check the saved model response, exact calculations, and cited source records.
7. Change coverage through an authorized policy or confirmed funding action.
8. Refresh the data and ask the same question again.
9. Check that the fixed calculation and explanation reflect the changed state.
10. Check abstention with stale or unavailable source data.

The application accepts at most ten assistant requests per organization per hour. At most two requests can be active at once. Model output has a fixed size limit. Source changes can make a saved answer stale. A stale answer cannot authorize funding.

The local tests use a simulated provider. They check immutable requests, current membership, source changes, invalid model output, rejected citations, and provider failures. They do not replace the live model check. Live model verification remains incomplete until the funded account and actual response have evidence.
