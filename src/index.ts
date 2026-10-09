import { config } from "./config.js";
import { app } from "./server.js";
import { startListener } from "./email/listener.js";
import { processInbound } from "./pipeline/run.js";
import { SupabaseStore } from "./db/store.js";
import { getCustomerByInbox } from "./db/customers.js";
import { supabase } from "./db/client.js";
import type { InboundEmail } from "./pipeline/types.js";
import { verifyFieldPulseCompany } from "./fieldpulse/service.js";

console.log("email_parser starting...");
console.log(`  Models: sort+checks=${config.JEV_MODEL} (min ${config.JEV_SORT_MIN_CONFIDENCE}/${config.JEV_CHECK_MIN})  read=${config.OPENROUTER_MODEL_EXTRACT}`);
console.log(`  Inbox(es): ${config.PARSER_INBOX_IDS.join(", ")}`);

const store = new SupabaseStore();

// Fail closed on an inbox with no customer row: we only subscribe to inboxes
// we configured, so an unknown one means the parser_customers table is behind.
async function routeInbound(email: InboundEmail): Promise<void> {
  const customer = await getCustomerByInbox(email.inbox_id);
  if (!customer) {
    console.error(`[ROUTE] No active customer for inbox "${email.inbox_id}" (message ${email.message_id}) -- not processing.`);
    return;
  }
  await processInbound(email, customer, store);
}

async function emailExists(messageId: string): Promise<boolean> {
  const { data } = await supabase.from("parser_emails").select("id").eq("message_id", messageId).maybeSingle();
  return Boolean(data);
}

void verifyFieldPulseCompany();

const server = app.listen(config.PORT, () => {
  console.log(`[HTTP] API listening on port ${config.PORT}`);
});

if (config.PARSER_LISTENER === "true") {
  startListener(routeInbound, emailExists).catch((err) => {
    console.error("Listener failed to start (API still works):", err);
  });
} else {
  console.warn("[WS] PARSER_LISTENER=false -- not subscribing to any inbox; API and page only.");
}

function shutdown() {
  console.log("\nShutting down...");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
