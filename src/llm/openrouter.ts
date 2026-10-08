// One structured call to OpenRouter (OpenAI-compatible). Plain fetch rather
// than the openai SDK, with retries on transient failures -- the same approach
// the support agent's payops classifier uses.
import { config } from "../config.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface ChatJsonResult {
  content: string;
  model: string;
  usage: { prompt_tokens?: number; completion_tokens?: number } | null;
}

export interface ChatJsonOptions {
  model?: string;
}

export type ChatJsonFn = (system: string, user: string, opts?: ChatJsonOptions) => Promise<ChatJsonResult>;

export const chatJson: ChatJsonFn = async (system, user, opts = {}) => {
  const model = opts.model ?? config.OPENROUTER_MODEL;
  const body = JSON.stringify({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const attempts = 3;
  let lastErr: Error = new Error("no attempts made");
  for (let i = 0; i < attempts; i++) {
    try {
      const resp = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(90_000),
      });
      if (!resp.ok) {
        const detail = `OpenRouter ${resp.status}: ${(await resp.text()).slice(0, 300)}`;
        if (resp.status >= 500 || resp.status === 429) {
          lastErr = new Error(detail);
        } else {
          throw new Error(detail);
        }
      } else {
        const json = (await resp.json()) as {
          model?: string;
          choices?: Array<{ message?: { content?: string } }>;
          usage?: ChatJsonResult["usage"];
        };
        return {
          content: json.choices?.[0]?.message?.content ?? "",
          model: json.model ?? model,
          usage: json.usage ?? null,
        };
      }
    } catch (e) {
      lastErr = e as Error;
    }
    if (i < attempts - 1) await wait(500 * (i + 1));
  }
  throw lastErr;
};

export function stripFences(s: string): string {
  return s
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}
