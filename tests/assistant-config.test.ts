import { expect, it } from "vitest";
import { configuredAssistantModel } from "../services/assistant/src/config.ts";
import { configuredExplanationProvider } from "../services/assistant/src/provider.ts";

it("Enables the API with a public model ID while only the worker receives a key", () => {
  const api = { ASSISTANT_ENABLED: "true", MODEL_ID: "test-model" };
  expect(configuredAssistantModel(api)).toBe("test-model");
  expect(() => configuredExplanationProvider(api)).toThrow("requires a model API key");
  expect(configuredExplanationProvider({ ...api, MODEL_API_KEY: "test-only" })?.model).toBe(
    "test-model",
  );
});
it("Disables both roles explicitly and rejects incomplete enabled settings", () => {
  const env = { ASSISTANT_ENABLED: "false", MODEL_ID: "test-model", MODEL_API_KEY: "test-only" };
  expect(configuredAssistantModel(env)).toBeUndefined();
  expect(configuredExplanationProvider(env)).toBeUndefined();
  expect(() => configuredAssistantModel({ ASSISTANT_ENABLED: "true" })).toThrow("MODEL_ID");
  expect(() => configuredAssistantModel({ ASSISTANT_ENABLED: "yes" })).toThrow("true or false");
});
it("Preserves the existing local configuration and never returns credentials as model metadata", () => {
  expect(configuredAssistantModel({ MODEL_ID: "test-model", MODEL_API_KEY: "test-only" })).toBe(
    "test-model",
  );
  expect(configuredAssistantModel({ MODEL_ID: "test-model", OPENAI_API_KEY: "test-only" })).toBe(
    "test-model",
  );
  expect(configuredAssistantModel({ MODEL_ID: "test-model" })).toBeUndefined();
  expect(configuredAssistantModel({ MODEL_API_KEY: "test-only" })).toBeUndefined();
});
