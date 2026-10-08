// Jev (TypeSafe's System One model) through the Vercel AI Gateway, the same
// route the Sidecar and support-agent trials use. Zero data retention is
// requested on every call.
//
// Jev answers fixed questions over a state object: a "choice" returns a
// probability per option plus a confidence; a "boolean" returns one
// probability. It never generates text, which is the point: it can sort and
// check, but it cannot invent a value.
import { config } from "../config.js";

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/evaluate";
const RETRY = new Set([429, 500, 502, 503, 504, 529]);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type JevState = string | Record<string, unknown> | unknown[];

export interface ChoiceQuestion {
  type: "choice";
  instructions: string | Record<string, unknown>;
  criteria: Record<string, string | Record<string, unknown> | null>;
}
export interface BooleanQuestion {
  type: "boolean";
  instructions: string | Record<string, unknown>;
  criteria?: { true?: string; false?: string };
}
export type JevQuestion = ChoiceQuestion | BooleanQuestion;

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}
export interface BooleanAnswer {
  type: "boolean";
  boolean: number;
}
export type JevAnswer = ChoiceAnswer | BooleanAnswer;

export interface JevResult {
  answers: Record<string, JevAnswer>;
  model: string;
  usage: { input_tokens?: number; output_tokens?: number } | null;
}

export type AskJevFn = (state: JevState, questions: Record<string, JevQuestion>) => Promise<JevResult>;

export const askJev: AskJevFn = async (state, questions) => {
  const body = JSON.stringify({
    model: config.JEV_MODEL,
    state,
    questions,
    providerOptions: { gateway: { zeroDataRetention: true } },
  });
  let lastErr: Error = new Error("no attempts made");
  for (let attempt = 1; attempt <= 4; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.AI_GATEWAY_API_KEY}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      lastErr = e as Error;
    }
    if (res?.ok) {
      const json = (await res.json()) as any;
      const answers: Record<string, JevAnswer> = {};
      for (const [id, a] of Object.entries<any>(json.answers ?? {})) {
        if (a?.type === "choice") {
          answers[id] = { type: "choice", choice: a.choice, confidence: Number(a.confidence), probabilities: a.probabilities ?? {} };
        } else {
          // The gateway calls TypeSafe's Noul a "boolean" and returns its value
          // as `probability` (confirmed with scripts/jev-smoke.ts, 2026-10-08).
          const value = a?.probability ?? a?.boolean ?? a?.noul ?? a?.value;
          answers[id] = { type: "boolean", boolean: Number(value) };
        }
      }
      // Gateway usage keys are camelCase on the wire (inputTokens / outputTokens).
      const u = json.usage ?? {};
      const usage = { input_tokens: u.inputTokens ?? u.input_tokens, output_tokens: u.outputTokens ?? u.output_tokens };
      return { answers, model: typeof json.model === "string" ? json.model : config.JEV_MODEL, usage };
    }
    if (res && !RETRY.has(res.status)) {
      throw new Error(`Jev gateway ${res.status}: ${(await res.text()).slice(0, 400)}`);
    }
    if (res) lastErr = new Error(`Jev gateway ${res.status}`);
    if (attempt < 4) await wait(Math.min(20_000, 1000 * 2 ** attempt));
  }
  throw lastErr;
};
