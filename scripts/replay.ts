// Run the pipeline on a .eml file. No AgentMail, no database (unless --db).
//
//   npm run replay -- fixtures/emails/servicechannel.eml
//   npm run replay -- fixtures/emails/*.eml --db      # also write to Supabase as customer "dev"
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import PostalMime from "postal-mime";
import { processInbound } from "../src/pipeline/run.js";
import { MemoryStore } from "../src/pipeline/memory-store.js";
import { DEFAULT_REQUIRED_FIELDS } from "../src/schema/record.js";
import type { Customer, InboundEmail, RunStore } from "../src/pipeline/types.js";

const args = process.argv.slice(2);
const useDb = args.includes("--db");
const files = args.filter((a) => !a.startsWith("--"));
if (!files.length) {
  console.error("usage: npm run replay -- <file.eml> [more.eml ...] [--db]");
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

for (const file of files) {
  console.log(`\n=== ${file} ===`);
  const email = await emlToInbound(file);
  const summary = await processInbound(email, customer, store);
  if (!summary) continue;
  if (!useDb) {
    const run = (store as MemoryStore).runs.get(summary.run_id)!;
    for (const s of run.steps) {
      console.log(`  ${s.position}. ${s.name.padEnd(10)} ${s.status.padEnd(7)} ${s.duration_ms}ms${s.error ? `  ${s.error}` : ""}`);
    }
  }
  console.log(`status: ${summary.status}  type: ${summary.email_type}  portal: ${summary.portal}`);
  if (summary.required_missing.length) console.log(`missing: ${summary.required_missing.join(", ")}`);
  if (summary.record) console.log(JSON.stringify(summary.record, null, 2));
}
