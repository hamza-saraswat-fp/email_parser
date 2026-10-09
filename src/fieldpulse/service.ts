// Delivery as the service runs it: approve a run -> deliver its record -> mark
// the run. Keeps the FieldPulse client, field-id cache and stores in one place
// so the API route stays thin.
import { config } from "../config.js";
import { supabase } from "../db/client.js";
import { FieldPulseClient } from "./client.js";
import { ensureJobCustomFields } from "./setup.js";
import { deliverRecord, type DeliveryResult } from "./deliver.js";
import { SupabaseDeliveryStore, getCachedFieldIds, cacheFieldIds } from "../db/deliveries.js";
import { serviceRequestSchema } from "../schema/record.js";
import type { FieldIds } from "./mapping.js";

export const fieldPulseConfigured = (): boolean => Boolean(config.FP_API_KEY);

let client: FieldPulseClient | null = null;
function getClient(): FieldPulseClient {
  if (!config.FP_API_KEY) throw new Error("FP_API_KEY is not set; delivery is disabled");
  return (client ??= new FieldPulseClient({ baseUrl: config.FP_API_BASE_URL, apiKey: config.FP_API_KEY }));
}

// Boot-time guard: the key must belong to FP_COMPANY_ID. Logs and returns false
// rather than throwing, so the page and the intake keep running.
export async function verifyFieldPulseCompany(): Promise<boolean> {
  if (!config.FP_API_KEY) { console.warn("[FP] FP_API_KEY not set -- delivery disabled"); return false; }
  try {
    const users: any = await getClient().get("/users", { limit: 50 });
    const list: any[] = Array.isArray(users) ? users : users?.data ?? [];
    const companies = [...new Set(list.map((u) => Number(u.company_id)))];
    if (config.FP_COMPANY_ID && !companies.includes(config.FP_COMPANY_ID)) {
      console.error(`[FP] key belongs to company ${companies.join(",")}, expected ${config.FP_COMPANY_ID} -- delivery disabled`);
      client = null;
      return false;
    }
    console.log(`[FP] connected to company ${companies.join(",")} (${list.length} user(s))`);
    return true;
  } catch (err) {
    console.error("[FP] connectivity check failed -- delivery disabled:", (err as Error).message);
    client = null;
    return false;
  }
}

async function fieldIdsFor(customerId: string): Promise<FieldIds> {
  const cached = (await getCachedFieldIds(customerId)) as FieldIds | null;
  if (cached && Object.keys(cached).length) return cached;
  const { ids } = await ensureJobCustomFields(getClient());
  await cacheFieldIds(customerId, ids as Record<string, number>);
  return ids;
}

export async function deliverRun(runId: string): Promise<DeliveryResult> {
  const { data: rec, error } = await supabase.from("parser_records").select("record, customer_id").eq("run_id", runId).maybeSingle();
  if (error) throw new Error(`parser_records get: ${error.message}`);
  if (!rec) throw new Error("run has no record to deliver");
  const record = serviceRequestSchema.parse(rec.record);
  await supabase.from("parser_runs").update({ status: "delivering" }).eq("id", runId);
  const t0 = Date.now();
  const position = await nextStepPosition(runId);
  try {
    const ids = await fieldIdsFor(record.customer_id);
    const result = await deliverRecord(record, { client: getClient(), fieldIds: ids, store: new SupabaseDeliveryStore(), runId });
    await supabase.from("parser_run_steps").insert({ run_id: runId, position, name: "delivered", status: "ok", input: { reference: record.reference.primary, organization: record.requester.organization, site: record.site.name }, output: result, error: null, duration_ms: Date.now() - t0 });
    await supabase.from("parser_runs").update({ status: "delivered" }).eq("id", runId);
    return result;
  } catch (err) {
    const message = (err as Error).message;
    await supabase.from("parser_run_steps").insert({ run_id: runId, position, name: "delivered", status: "failed", input: { reference: record.reference.primary }, output: null, error: message, duration_ms: Date.now() - t0 });
    await supabase.from("parser_runs").update({ status: "delivery_failed", error: message }).eq("id", runId);
    throw err;
  }
}

async function nextStepPosition(runId: string): Promise<number> {
  const { data } = await supabase.from("parser_run_steps").select("position").eq("run_id", runId).order("position", { ascending: false }).limit(1).maybeSingle();
  return ((data?.position as number | undefined) ?? 0) + 1;
}
