// Create an AgentMail inbox on the verified domain.
//   npm run create-inbox -- parser-dev "Email parser (dev)"
import { AgentMailClient } from "agentmail";
import { config } from "../src/config.js";

const [username, displayName] = process.argv.slice(2);
if (!username) {
  console.error('usage: npm run create-inbox -- <username> ["Display name"]');
  process.exit(1);
}
const client = new AgentMailClient({ apiKey: config.AGENTMAIL_API_KEY });
const inbox = await client.inboxes.create({
  username,
  domain: "agent.fieldpulse.com",
  displayName: displayName ?? "FieldPulse Email Parser",
  clientId: `email-parser-${username}`,
});
console.log(`created: ${inbox.inboxId}`);
