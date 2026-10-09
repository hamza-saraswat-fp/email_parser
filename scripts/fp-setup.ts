// Create the parser's job custom fields in the FieldPulse company (idempotent).
//   npm run fp:setup            # dry run: shows what would be created
//   npm run fp:setup -- --live  # creates the missing fields
import { config } from "../src/config.js";
import { FieldPulseClient } from "../src/fieldpulse/client.js";
import { ensureJobCustomFields } from "../src/fieldpulse/setup.js";

if (!config.FP_API_KEY) { console.error("FP_API_KEY is not set"); process.exit(1); }
const live = process.argv.includes("--live");
const client = new FieldPulseClient({ baseUrl: config.FP_API_BASE_URL, apiKey: config.FP_API_KEY });
const { ids, created } = await ensureJobCustomFields(client, { dryRun: !live });
console.log(live ? `created: ${created.length ? created.join(", ") : "nothing (all present)"}` : "dry run, nothing created");
console.log("field ids:", JSON.stringify(ids));
