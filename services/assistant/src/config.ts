import { z } from "zod";

type Environment = Record<string, string | undefined>;
export function configuredAssistantModel(env: Environment = process.env): string | undefined {
  const enabled = env.ASSISTANT_ENABLED;
  if (enabled !== undefined && enabled !== "" && !["true", "false"].includes(enabled))
    throw new Error("ASSISTANT_ENABLED must be true or false.");
  if (enabled === "false") return undefined;
  if (enabled !== "true" && !(env.MODEL_API_KEY || env.OPENAI_API_KEY)) return undefined;
  if (!env.MODEL_ID && enabled !== "true") return undefined;
  const model = z
    .string()
    .regex(/^[a-zA-Z0-9._:-]{1,100}$/)
    .safeParse(env.MODEL_ID);
  if (!model.success) throw new Error("Configure a valid MODEL_ID before enabling the assistant.");
  return model.data;
}
