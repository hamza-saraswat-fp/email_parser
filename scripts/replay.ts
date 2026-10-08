// Run the pipeline on .eml files. No AgentMail, no database (unless --db).
//
//   npm run replay -- fixtures/emails/servicechannel.eml
//   npm run replay -- fixtures/emails/*.eml --db                    # also write to Supabase as customer "dev"
//   npm run replay -- fixtures/emails/*.eml --classify-model anthropic/claude-haiku-5.5 \
//                     --extract-model anthropic/claude-sonnet-5.5 --out tmp/models/try1
//
// --out writes one JSON per email (summary, steps with timings, record) so two
// runs can be diffed with scripts/compare-records.ts.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import PostalMime from "postal-mime";
import { processInbound } from "../src/pipeline/run.js";
import { MemoryStore } from "../src/pipeline/memory-store.js";
import { DEFAULT_REQUIRED_FIELDS } from "../src/schema/record.js";
import type { Customer, InboundEmail, RunStore } from "../src/pipeline/types.js";

const argv = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const useDb = argv.includes("--db");
const outDir = flag("--out");
const models = { classify: flag("--classify-model"), extract: flag("--extract-model") };
const files = argv.filter((a, i) => !a.startsWith("--") && !["--out", "--classify-model", "--extract-model"].includes(argv[i - 1] ?? ""));
if (!files.length) {
  console.error("usage: npm run replay -- <file.eml> [more.eml ...] [--db] [--out dir] [--classify-model id] [--extract-model id]");
  process.exit(1);
}

export async function emlToInbound(path: string): Promise<InboundEmail> {
  const raw = await readFile(path);
  const parsed = await PostalMime.parse(raw);
  const from = parsed.from;
  return {
    message_id: parsed.messageId ?? `replay-${basename(path)}-${Date.now()}`,
    inbox_id: "parser_test@agentmail.to",
    from_email: from?.address?.toLowerCase() ?? null,
    from_name: from?.name || null,
    to: (parsed.to ?? []).map((t) => t.address ?? "").filter(Boolean),
    subject: parsed.subject ?? null,
    text: parsed.text ?? null,
    html: parsed.html ?? null,
    attachments: (parsed.attachments ?? []).map((a) => ({
      attachment_id: null,
      filename: a.filename ?? null,
      size: typeof a.content === "string" ? a.content.length : (a.content as ArrayBuffer | undefined)?.byteLength ?? null,
      content_type: a.mimeType ?? null,
    })),
    received_at: parsed.date ? new Date(parsed.date).toISOString() : new Date().toISOString(),
  };
}

const customer: Customer = {
  id: "dev",
  name: "Local development",
  inbox_id: "parser_test@agentmail.to",
  required_fields: DEFAULT_REQUIRED_FIELDS,
};

let store: RunStore;
if (useDb) {
  const { SupabaseStore } = await import("../src/db/store.js");
  store = new SupabaseStore();
} else {
  store = new MemoryStore();
}
if (outDir) await mkdir(outDir, { recursive: true });

for (const file of files) {
  console.log(`\n=== ${file} ===`);
  const email = await emlToInbound(file);
  const summary = await processInbound(email, customer, store, { models });
  if (!summary) continue;
  const run = useDb ? null : (store as MemoryStore).runs.get(summary.run_id)!;
  if (run) {
    for (const s of run.steps) {
      const model = (s.output as { model?: string } | null)?.model;
      console.log(`  ${s.position}. ${s.name.padEnd(10)} ${s.status.padEnd(7)} ${String(s.duration_ms).padStart(5)}ms${model ? `  ${model}` : ""}${s.error ? `  ${s.error}` : ""}`);
    }
  }
  console.log(`status: ${summary.status}  type: ${summary.email_type}  portal: ${summary.portal}`);
  if (summary.required_missing.length) console.log(`missing: ${summary.required_missing.join(", ")}`);
  if (summary.record && !outDir) console.log(JSON.stringify(summary.record, null, 2));
  if (outDir) {
    const out = {
      file,
      summary: { status: summary.status, email_type: summary.email_type, portal: summary.portal, required_missing: summary.required_missing, error: summary.error },
      steps: (run?.steps ?? []).map((s) => ({ name: s.name, status: s.status, duration_ms: s.duration_ms, model: (s.output as { model?: string } | null)?.model ?? null })),
      record: summary.record,
    };
    const target = join(outDir, basename(file).replace(/\.eml$/i, "") + ".json");
    await writeFile(target, JSON.stringify(out, null, 2));
    console.log(`wrote ${target}`);
  }
}
