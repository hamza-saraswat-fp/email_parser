// Live smoke test, no database: start the listener against the configured
// inbox, send a fixture into it through AgentMail, and wait for the pipeline
// to finish on the in-memory store.
//
//   npx tsx scripts/smoke-live.ts fixtures/emails/sample-servicechannel.eml
import { readFile } from "node:fs/promises";
import PostalMime from "postal-mime";
import { AgentMailClient } from "agentmail";
import { config } from "../src/config.js";
import { startListener } from "../src/email/listener.js";
import { processInbound } from "../src/pipeline/run.js";
import { MemoryStore } from "../src/pipeline/memory-store.js";
import { DEFAULT_REQUIRED_FIELDS } from "../src/schema/record.js";
import type { Customer, InboundEmail } from "../src/pipeline/types.js";

const [file] = process.argv.slice(2);
if (!file) { console.error("usage: npx tsx scripts/smoke-live.ts <file.eml>"); process.exit(1); }

const inboxId = config.PARSER_INBOX_IDS[0];
const customer: Customer = { id: "dev", name: "Local development", inbox_id: inboxId, required_fields: DEFAULT_REQUIRED_FIELDS };
const store = new MemoryStore();
const marker = `smoke-${Date.now()}`;

let resolveDone!: (v: unknown) => void;
const done = new Promise((r) => { resolveDone = r; });

// Only process the message we are about to send; catch-up may replay older mail.
async function routeInbound(email: InboundEmail) {
  if (!(email.subject ?? "").includes(marker)) {
    console.log(`[SMOKE] ignoring unrelated inbound "${email.subject}"`);
    return;
  }
  const summary = await processInbound(email, customer, store);
  resolveDone(summary);
}

await startListener(routeInbound, async () => true);

// Give the subscribe + catch-up a moment, then send.
await new Promise((r) => setTimeout(r, 4000));
const parsed = await PostalMime.parse(await readFile(file));
const client = new AgentMailClient({ apiKey: config.AGENTMAIL_API_KEY });
const sender = await client.inboxes.create({ username: "parser-fixture-sender", displayName: "Fixture sender", clientId: "email-parser-fixture-sender" });
const subject = `${parsed.subject ?? "(no subject)"} [${marker}]`;
await client.inboxes.messages.send(sender.inboxId, { to: [inboxId], subject, text: parsed.text ?? undefined, html: parsed.html ?? undefined });
console.log(`[SMOKE] sent "${subject}" from ${sender.inboxId} to ${inboxId}; waiting for the run...`);

const timeout = new Promise((r) => setTimeout(() => r("timeout"), 120_000));
const result = await Promise.race([done, timeout]);
if (result === "timeout") {
  console.error("[SMOKE] no run completed within 120s");
  process.exit(2);
}
const summary = result as Awaited<ReturnType<typeof processInbound>>;
console.log("[SMOKE] result:", JSON.stringify({ status: summary?.status, email_type: summary?.email_type, portal: summary?.portal, missing: summary?.required_missing }, null, 0));
if (summary?.record) {
  const r = summary.record;
  console.log("[SMOKE] record:", JSON.stringify({ reference: r.reference.primary, site: r.site.name, address: r.site.address.line1, nte: r.limits.not_to_exceed?.amount, description: r.work.description?.slice(0, 60) }));
}
process.exit(0);
