// Read-only connectivity check against the FieldPulse API. Nothing is written.
//   npm run fp:check
import { config } from "../src/config.js";
import { FieldPulseClient } from "../src/fieldpulse/client.js";

if (!config.FP_API_KEY) { console.error("FP_API_KEY is not set"); process.exit(1); }
const client = new FieldPulseClient({ baseUrl: config.FP_API_BASE_URL, apiKey: config.FP_API_KEY });
const ROLE: Record<number, string> = { 1: "Admin", 2: "Manager", 3: "Advanced Service Agent", 4: "Service Agent", 5: "Limited" };

console.log(`host: ${config.FP_API_BASE_URL}  expected company: ${config.FP_COMPANY_ID ?? "(unset)"}`);

const users = await client.get<any>("/users", { limit: 50 });
const list: any[] = Array.isArray(users) ? users : users?.users ?? users?.data ?? [];
console.log(`\nusers (${list.length}):`);
for (const u of list) console.log(`  #${u.id} ${u.first_name ?? ""} ${u.last_name ?? ""} <${u.email ?? ""}> role=${u.role} (${ROLE[u.role] ?? "?"}) company_id=${u.company_id}`);
const companies = new Set(list.map((u) => u.company_id));
if (config.FP_COMPANY_ID && list.length && !companies.has(config.FP_COMPANY_ID)) {
  console.error(`\nSTOP: the key belongs to company ${[...companies].join(",")}, not ${config.FP_COMPANY_ID}.`);
  process.exit(2);
}

// No server-side filter: the related_record_names filter 500s. List everything and sort client-side.
const fields = await client.get<any>("/custom-fields/instances", { limit: 200 });
const flist: any[] = Array.isArray(fields) ? fields : fields?.data ?? [];
console.log(`\ncustom field instances (${flist.length}):`);
for (const f of flist) console.log(`  #${f.id} "${f.name}" widget=${f.field_widget_id} object=${JSON.stringify(f.object ?? f.related_record_names)} active=${f.is_active} position=${f.position}`);
if (flist[0]) console.log("  sample keys:", Object.keys(flist[0]).join(", "));

const wf = await client.get<any>("/status-workflow", { limit: 50 });
const wlist: any[] = Array.isArray(wf) ? wf : wf?.data ?? [];
console.log(`\nstatus workflows (${wlist.length}):`);
for (const w of wlist) console.log(`  #${w.id} "${w.name ?? w.title}" object=${w.object_type} default=${w.is_default} active=${w.is_active}`);

const jobs = await client.get<any>("/job", { limit: 1 });
const jlist: any[] = Array.isArray(jobs) ? jobs : jobs?.data ?? [];
console.log(`\njobs visible: ${jlist.length ? "at least 1 (first cuid " + jlist[0].cuid + ")" : "none"}`);
console.log("\nOK: key works, read-only.");
