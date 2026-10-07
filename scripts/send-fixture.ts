// Push a .eml fixture into an inbox through AgentMail, to exercise the listener.
//   npm run send-fixture -- fixtures/emails/servicechannel.eml [parser-dev@agent.fieldpulse.com]
import { readFile } from "node:fs/promises";
import PostalMime from "postal-mime";
import { AgentMailClient } from "agentmail";
import { config } from "../src/config.js";

const [file, to = config.PARSER_INBOX_IDS[0]] = process.argv.slice(2);
if (!file) {
  console.error("usage: npm run send-fixture -- <file.eml> [inbox id]");
  process.exit(1);
}
const parsed = await PostalMime.parse(await readFile(file));
const client = new AgentMailClient({ apiKey: config.AGENTMAIL_API_KEY });
// A separate sender inbox on the default domain, so the parser inbox sees a
// genuine inbound message. clientId makes this idempotent.
const sender = await client.inboxes.create({
  username: "parser-fixture-sender",
  displayName: "Fixture sender",
  clientId: "email-parser-fixture-sender",
});
await client.inboxes.messages.send(sender.inboxId, {
  to: [to],
  subject: parsed.subject ?? "(no subject)",
  text: parsed.text ?? undefined,
  html: parsed.html ?? undefined,
});
console.log(`sent "${parsed.subject}" from ${sender.inboxId} to ${to}`);
