import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  OPENROUTER_MODEL: z.string().default("anthropic/claude-sonnet-4"),
  // The reader's model. Unset = OPENROUTER_MODEL.
  OPENROUTER_MODEL_EXTRACT: z.string().optional(),
  // Jev (TypeSafe) through the Vercel AI Gateway: sorting and semantic checks.
  AI_GATEWAY_API_KEY: z.string().min(1, "AI_GATEWAY_API_KEY is required"),
  JEV_MODEL: z.string().default("typesafe-ai/jev"),
  // Below this, a sort result is not acted on: the run goes to a person.
  JEV_SORT_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.7),
  // Below this, a semantic check fails and the run goes to a person.
  JEV_CHECK_MIN: z.coerce.number().min(0).max(1).default(0.7),
  AGENTMAIL_API_KEY: z.string().min(1, "AGENTMAIL_API_KEY is required"),
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
  SUPABASE_SERVICE_KEY: z.string().min(1, "SUPABASE_SERVICE_KEY is required"),
  PARSER_INBOX_IDS: z
    .string()
    .min(1, "PARSER_INBOX_IDS is required")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  PORT: z.coerce.number().default(3000),
  // Set to "false" to serve the API and page without subscribing to the inbox
  // (local UI work while Railway owns the inbox; two listeners would race).
  PARSER_LISTENER: z.enum(["true", "false"]).default("true"),
  // Universal Auth (fieldpulse-auth). When set, every /api call must carry a
  // FieldPulse-issued token. Unset = open API, for local dev and tests only.
  // An empty string counts as unset, so `FP_AUTH_URL= npm run ...` can turn
  // sign-in off for local UI work even though .env sets it.
  FP_AUTH_URL: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().url().optional()),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = {
  ...parsed.data,
  OPENROUTER_MODEL_EXTRACT: parsed.data.OPENROUTER_MODEL_EXTRACT ?? parsed.data.OPENROUTER_MODEL,
};
