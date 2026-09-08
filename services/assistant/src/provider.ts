import { z } from "zod";
import { answerSchema, type CoverageSnapshot, SYSTEM_PROMPT } from "./contract.ts";
export interface ExplanationProvider {
  model: string;
  generate(
    question: string,
    snapshot: CoverageSnapshot,
    requestId: string,
  ): Promise<{
    answer: unknown;
    responseId: string;
    model: string;
    usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  }>;
}
export class OpenAIExplanationProvider implements ExplanationProvider {
  constructor(
    private key: string,
    public model: string,
    private request: typeof fetch = fetch,
  ) {
    if (!key || !/^[a-zA-Z0-9._:-]{1,100}$/.test(model))
      throw new Error("Configure a model API key and model ID.");
  }
  async generate(question: string, snapshot: CoverageSnapshot, requestId: string) {
    let response: Response;
    try {
      response = await this.request("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/json",
          "X-Client-Request-Id": requestId,
        },
        body: JSON.stringify({
          model: this.model,
          store: false,
          tools: [],
          input: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify({ question, snapshot }) },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "coverage_explanation",
              strict: true,
              schema: z.toJSONSchema(answerSchema),
            },
          },
          max_output_tokens: 6000,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(90000),
      });
    } catch {
      throw new Error("MODEL_REQUEST_FAILED");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("MODEL_REQUEST_FAILED");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("MODEL_RESPONSE_INVALID");
    let length = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 131072) throw new Error("MODEL_RESPONSE_INVALID");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const result = z
      .object({
        id: z.string().min(1).max(200),
        model: z.string().min(1).max(100),
        status: z.literal("completed"),
        output: z
          .array(
            z.object({
              type: z.string(),
              content: z
                .array(z.object({ type: z.string(), text: z.string().optional() }))
                .optional(),
            }),
          )
          .max(20),
        usage: z.object({
          input_tokens: z.number().int().nonnegative(),
          output_tokens: z.number().int().nonnegative(),
          total_tokens: z.number().int().nonnegative(),
        }),
      })
      .parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    const messages = result.output.filter((item) => item.type === "message");
    const content = messages.flatMap((item) => item.content ?? []);
    if (content.length !== 1 || content[0].type !== "output_text" || !content[0].text)
      throw new Error("MODEL_RESPONSE_INVALID");
    if (result.output.some((item) => !["message", "reasoning"].includes(item.type)))
      throw new Error("MODEL_RESPONSE_INVALID");
    return {
      answer: JSON.parse(content[0].text),
      responseId: result.id,
      model: result.model,
      usage: {
        inputTokens: result.usage.input_tokens,
        outputTokens: result.usage.output_tokens,
        totalTokens: result.usage.total_tokens,
      },
    };
  }
}
export function configuredExplanationProvider() {
  const key = process.env.MODEL_API_KEY || process.env.OPENAI_API_KEY,
    model = process.env.MODEL_ID;
  if (!key || !model) return undefined;
  return new OpenAIExplanationProvider(key, model);
}
