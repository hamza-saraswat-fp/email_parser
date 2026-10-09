// Deliver a record into FieldPulse, from a run id (database) or an .eml fixture.
//   npm run fp:deliver -- fixtures/emails/heb.eml            # dry run: prints the payloads it would send
//   npm run fp:deliver -- fixtures/emails/heb.eml --live     # creates customer/location/job in FieldPulse
//   npm run fp:deliver -- <run id> --live                    # same, from a stored run's record
import { config } from "../src/config.js";
import { FieldPulseClient } from "../src/fieldpulse/client.js";
import { ensureJobCustomFields } from "../src/fieldpulse/setup.js";
import { customerPayload, locationPayload, jobPayload, type FieldIds } from "../src/fieldpulse/mapping.js";
import { deliverRecord, MemoryDeliveryStore, type DeliveryStore } from "../src/fieldpulse/deliver.js";
import { serviceRequestSchema, DEFAULT_REQUIRED_FIELDS, type ServiceRequest } from "../src/schema/record.js";
import { processInbound } from "../src/pipeline/run.js";
import { MemoryStore } from "../src/pipeline/memory-store.js";
import { emlToInbound } from "./replay.js";

const args = process.argv.slice(2);
const live = args.includes("--live");
const target = args.find((a) => !a.startsWith("--"));
if (!target) { console.error("usage: npm run fp:deliver -- <run id | file.eml> [--live]"); process.exit(1); }
if (!config.FP_API_KEY) { console.error("FP_API_KEY is not set"); process.exit(1); }

const client = new FieldPulseClient({ baseUrl: config.FP_API_BASE_URL, apiKey: config.FP_API_KEY });

let record: ServiceRequest;
let runId: string | null = null;
let store: DeliveryStore;
let cacheIds: ((ids: FieldIds) => Promise<void>) | null = null;
let cachedIds: FieldIds | null = null;

if (target.endsWith(".eml")) {
  const email = await emlToInbound(target);
  const customer = { id: "dev", name: "dev", inbox_id: "parser_test@agentmail.to", required_fields: DEFAULT_REQUIRED_FIELDS };
  const summary = await processInbound(email, customer, new MemoryStore(), { log: () => {} });
  if (!summary?.record) { console.error(`pipeline did not produce a record: ${summary?.status} ${summary?.error ?? ""}`); process.exit(1); }
  record = summary.record;
  store = new MemoryDeliveryStore();
} else {
  const { supabase } = await import("../src/db/client.js");
  const { SupabaseDeliveryStore, getCachedFieldIds, cacheFieldIds } = await import("../src/db/deliveries.js");
  const { data, error } = await supabase.from("parser_records").select("record").eq("run_id", target).maybeSingle();
  if (error || !data) { console.error(`no record for run ${target}: ${error?.message ?? "not found"}`); process.exit(1); }
  record = serviceRequestSchema.parse(data.record);
  runId = target;
  store = new SupabaseDeliveryStore();
  cachedIds = (await getCachedFieldIds(record.customer_id)) as FieldIds | null;
  cacheIds = (ids) => cacheFieldIds(record.customer_id, ids as Record<string, number>);
}

console.log(`\nrecord: ${record.reference.primary} · ${record.requester.organization} · ${record.site.name} (${record.source.portal})`);

if (!live) {
  console.log("\n--- DRY RUN: nothing is sent ---");
  const { ids } = await ensureJobCustomFields(client, { dryRun: true, log: (s) => console.log(s) });
  console.log("\ncustomer payload:", JSON.stringify({ ...customerPayload(record), locations: [locationPayload(record)] }, null, 2));
  console.log("\nlocation payload (if the customer already exists):", JSON.stringify(locationPayload(record), null, 2));
  console.log("\njob payload (customer_id/location_id filled in at delivery):", JSON.stringify(jobPayload(record, 0, 0, ids), null, 2));
  console.log("\nlookups that would run: GET /job?search=<reference>, GET /customer?search=<organization>, GET /location?filter[object_id]=<customer>");
  process.exit(0);
}

const { ids, created } = cachedIds ?? (await ensureJobCustomFields(client));
if (created.length && cacheIds) await cacheIds(ids);
if (!cachedIds && cacheIds) await cacheIds(ids);
console.log("field ids:", JSON.stringify(ids));
const result = await deliverRecord(record, { client, fieldIds: ids, store, runId });
console.log("\nresult:", JSON.stringify(result, null, 2));
