// Deliver an approved record into FieldPulse: find or create the customer, find
// or create the store location, create the job. Idempotent on the reference
// number, from our side (parser_deliveries) and theirs (job search).
import { FieldPulseClient, FieldPulseError } from "./client.js";
import { customerPayload, locationPayload, jobPayload, normalizeName, type FieldIds } from "./mapping.js";
import type { ServiceRequest } from "../schema/record.js";

export interface DeliveryRow {
  run_id: string | null;
  customer_id: string;
  reference: string;
  status: "delivered" | "failed";
  fp_customer_id: number | null;
  fp_location_id: number | null;
  fp_job_id: number | null;
  fp_job_cuid: string | null;
  created_customer: boolean;
  created_location: boolean;
  request: unknown;
  response: unknown;
  error: string | null;
}

export interface DeliveryStore {
  findDelivered(customerId: string, reference: string): Promise<DeliveryRow | null>;
  save(row: DeliveryRow): Promise<void>;
}

export class MemoryDeliveryStore implements DeliveryStore {
  rows: DeliveryRow[] = [];
  async findDelivered(customerId: string, reference: string) {
    return this.rows.find((r) => r.customer_id === customerId && r.reference === reference && r.status === "delivered") ?? null;
  }
  async save(row: DeliveryRow) { this.rows.push(row); }
}

export interface DeliveryResult {
  outcome: "created" | "already_delivered" | "found_in_fieldpulse";
  fp_customer_id: number | null;
  fp_location_id: number | null;
  fp_job_id: number | null;
  fp_job_cuid: string | null;
  created_customer: boolean;
  created_location: boolean;
  trail: string[];
}

// The morph class FieldPulse expects for a customer-owned location.
export const CUSTOMER_MORPH_CLASS = "App\\Http\\Api\\Core\\Models\\BaseCustomer";

const asList = (v: any): any[] => (Array.isArray(v) ? v : v?.data ?? v?.customers ?? v?.jobs ?? v?.locations ?? []);

export async function deliverRecord(
  record: ServiceRequest,
  opts: { client: FieldPulseClient; fieldIds: FieldIds; store: DeliveryStore; runId?: string | null; log?: (s: string) => void },
): Promise<DeliveryResult> {
  const { client, fieldIds, store } = opts;
  const log = opts.log ?? ((s) => console.log(s));
  const trail: string[] = [];
  const say = (s: string) => { trail.push(s); log(`[DELIVER] ${s}`); };
  const reference = record.reference.primary?.trim();
  if (!reference) throw new Error("record has no reference number; refusing to deliver");

  // 1. Our own ledger.
  const prior = await store.findDelivered(record.customer_id, reference);
  if (prior) {
    say(`reference ${reference} already delivered as job #${prior.fp_job_cuid ?? prior.fp_job_id}`);
    return { outcome: "already_delivered", fp_customer_id: prior.fp_customer_id, fp_location_id: prior.fp_location_id, fp_job_id: prior.fp_job_id, fp_job_cuid: prior.fp_job_cuid, created_customer: false, created_location: false, trail };
  }

  // 2. FieldPulse's own records (jobs created outside this table).
  const hits = asList(await client.get<any>("/job", { search: reference, limit: 5 }));
  const existing = hits.find((j) => typeof j.subtitle === "string" && j.subtitle.startsWith(reference));
  if (existing) {
    say(`FieldPulse already has job ${existing.cuid ?? existing.id} for reference ${reference}`);
    const row: DeliveryRow = { run_id: opts.runId ?? null, customer_id: record.customer_id, reference, status: "delivered", fp_customer_id: existing.customer_id ?? null, fp_location_id: existing.location_id ?? null, fp_job_id: existing.id, fp_job_cuid: existing.cuid ? String(existing.cuid) : null, created_customer: false, created_location: false, request: null, response: existing, error: null };
    await store.save(row);
    return { outcome: "found_in_fieldpulse", fp_customer_id: row.fp_customer_id, fp_location_id: row.fp_location_id, fp_job_id: row.fp_job_id, fp_job_cuid: row.fp_job_cuid, created_customer: false, created_location: false, trail };
  }

  const request: Record<string, unknown> = {};
  try {
    // 3. Customer.
    const custBody = customerPayload(record);
    const wanted = normalizeName(custBody.company_name);
    const candidates = asList(await client.get<any>("/customer", { search: custBody.company_name, limit: 10 }));
    let customer = candidates.find((c) => normalizeName(c.company_name) === wanted || normalizeName(c.display_name) === wanted) ?? null;
    let createdCustomer = false;
    let location: any = null;
    let createdLocation = false;
    if (customer) {
      say(`customer "${custBody.company_name}" found: #${customer.id}`);
    } else {
      // Inline locations need the morph class too (locations.*.object_type is required).
      request.customer = { ...custBody, locations: [{ ...locationPayload(record), object_type: CUSTOMER_MORPH_CLASS }] };
      customer = await client.post<any>("/customer", request.customer);
      createdCustomer = true;
      say(`customer "${custBody.company_name}" created: #${customer.id}`);
      location = asList(customer.locations)[0] ?? null;
      if (location) { createdLocation = true; say(`location "${location.title}" created with the customer: #${location.id}`); }
    }

    // 4. Location under that customer.
    if (!location) {
      const locBody = locationPayload(record);
      const wantId = record.site.identifier?.trim();
      const wantAddr = normalizeName(locBody.address_1);
      let locs: any[] = [];
      try {
        locs = asList(await client.get<any>("/location", { "filter[0][attribute]": "object_id", "filter[0][value]": customer.id, limit: 100 }));
      } catch (e) {
        say(`location lookup by customer failed (${(e as Error).message}); falling back to the customer's own list`);
        locs = asList(customer.locations);
      }
      locs = locs.filter((l) => l.object_id == null || Number(l.object_id) === Number(customer.id));
      location =
        (wantId && locs.find((l) => typeof l.title === "string" && (l.title.includes(`#${wantId}`) || normalizeName(l.title).endsWith(` ${normalizeName(wantId)}`)))) ||
        (wantAddr && locs.find((l) => normalizeName(l.address_1) === wantAddr)) ||
        null;
      if (location) {
        say(`location "${location.title}" found: #${location.id}`);
      } else {
        request.location = { ...locBody, object_type: CUSTOMER_MORPH_CLASS, object_id: customer.id };
        location = await client.post<any>("/location", request.location);
        createdLocation = true;
        say(`location "${locBody.title}" created: #${location.id}`);
      }
    }

    // 5. Job.
    request.job = jobPayload(record, Number(customer.id), location ? Number(location.id) : null, fieldIds);
    const job = await client.post<any>("/job", request.job);
    say(`job created: #${job.id} (cuid ${job.cuid})`);
    const row: DeliveryRow = {
      run_id: opts.runId ?? null, customer_id: record.customer_id, reference, status: "delivered",
      fp_customer_id: Number(customer.id), fp_location_id: location ? Number(location.id) : null, fp_job_id: Number(job.id), fp_job_cuid: job.cuid != null ? String(job.cuid) : null,
      created_customer: createdCustomer, created_location: createdLocation, request, response: { customer_id: customer.id, location_id: location?.id ?? null, job: { id: job.id, cuid: job.cuid, status: job.status, status_id: job.status_id } }, error: null,
    };
    await store.save(row);
    return { outcome: "created", fp_customer_id: row.fp_customer_id, fp_location_id: row.fp_location_id, fp_job_id: row.fp_job_id, fp_job_cuid: row.fp_job_cuid, created_customer: createdCustomer, created_location: createdLocation, trail };
  } catch (err) {
    const message = err instanceof FieldPulseError ? `${err.message} (HTTP ${err.status}${err.errors ? ": " + JSON.stringify(err.errors).slice(0, 500) : ""})` : (err as Error).message;
    say(`failed: ${message}`);
    await store.save({ run_id: opts.runId ?? null, customer_id: record.customer_id, reference, status: "failed", fp_customer_id: null, fp_location_id: null, fp_job_id: null, fp_job_cuid: null, created_customer: false, created_location: false, request, response: null, error: message });
    throw new Error(message);
  }
}
