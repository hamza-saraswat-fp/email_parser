// One-time setup per FieldPulse company: make sure the five job custom fields
// exist and return their instance ids. Idempotent: existing fields are matched
// by name (case-insensitive); only missing ones are created.
import { FieldPulseClient } from "./client.js";
import { JOB_CUSTOM_FIELDS, type FieldIds, type FieldKey } from "./mapping.js";

interface Instance { id: number; name: string; object?: string; related_record_names?: unknown; field_widget_id?: number; position?: number; is_active?: boolean }

const asList = (v: any): any[] => (Array.isArray(v) ? v : v?.data ?? []);
const isJobField = (f: Instance) => f.object === "job" || (Array.isArray(f.related_record_names) && f.related_record_names.includes("job"));

export async function listJobCustomFields(client: FieldPulseClient): Promise<Instance[]> {
  const all = asList(await client.get<any>("/custom-fields/instances", { limit: 200 }));
  return all.filter(isJobField);
}

export async function ensureJobCustomFields(client: FieldPulseClient, opts: { dryRun?: boolean; log?: (s: string) => void } = {}): Promise<{ ids: FieldIds; created: string[] }> {
  const log = opts.log ?? ((s) => console.log(s));
  const existing = await listJobCustomFields(client);
  const byName = new Map(existing.map((f) => [f.name.trim().toLowerCase(), f]));
  let nextPosition = existing.reduce((m, f) => Math.max(m, f.position ?? 0), -1) + 1;
  const ids: FieldIds = {};
  const created: string[] = [];
  for (const spec of JOB_CUSTOM_FIELDS) {
    const found = byName.get(spec.name.toLowerCase());
    if (found) { ids[spec.key as FieldKey] = found.id; continue; }
    const body = { name: spec.name, object: "job", field_widget_id: spec.widget, position: nextPosition++, permission: "1,2,4", edit_permission: "1,2,4", is_active: true, settings: {} };
    if (opts.dryRun) { log(`[FP] would create custom field ${JSON.stringify(body)}`); continue; }
    const made = await client.post<Instance>("/custom-fields/instances", body);
    ids[spec.key as FieldKey] = made.id;
    created.push(spec.name);
    log(`[FP] created job custom field "${spec.name}" -> #${made.id}`);
  }
  return { ids, created };
}
