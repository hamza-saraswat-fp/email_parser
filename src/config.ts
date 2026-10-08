import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  OPENROUTER_MODEL: z.string().default("anthropic/claude-sonnet-4"),
  AGENTMAIL_API_KEY: z.string().min(1, "AGENTMAIL_API_KEY is required"),
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
  SUPABASE_SERVICE_KEY: z.string().min(1, "SUPABASE_SERVICE_KEY is required"),
  PARSER_INBOX_IDS: z
    .string()
    .min(1, "PARSER_INBOX_IDS is required")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  PORT: z.coerce.number().default(3000),
  // Universal Auth (fieldpulse-auth). When set, every /api call must carry a
  // FieldPulse-issued token. Unset = open API, for local dev and tests only.
  FP_AUTH_URL: z.string().url().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;
