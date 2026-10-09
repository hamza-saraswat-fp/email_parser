import { describe, it, expect } from "vitest";
import { deliverRecord, MemoryDeliveryStore, CUSTOMER_MORPH_CLASS } from "./deliver.js";
import { FieldPulseClient } from "./client.js";
import { serviceRequestSchema } from "../schema/record.js";

const rec = serviceRequestSchema.parse({
  schema_version: "1.0", record_type: "service_request", customer_id: "dev",
  source: { portal: "heb", sender_email: null, subject: "H-E-B Work order request #WO-2602977", message_id: "m", received_at: "2026-09-09T13:12:00.000Z" },
  email_type: "new_request",
  reference: { primary: "WO-2602977", all: [{ label: "Work Order", value: "WO-2602977" }] },
  requester: { organization: "H-E-B", contact_name: "Jesse Hernandez", contact_email: null, contact_phone: null },
  site: { name: "770 KERR1 KERRVILLE 01 MAIN/HAYS ST", identifier: "770.0", address: { line1: "300 Main St", line2: null, city: "Kerrville", state: "TX", postal_code: "78028", country: null }, phone: "(830) 896-3600" },
  work: { trade: "Lighting", category: null, area: "Wareroom", asset: null, description: "Outside light fixture is out." },
  priority: { raw: "24 hours (Next Business Day)" },
  deadlines: { accept_by: null, on_site_by: null, complete_by: null, scheduled_for: null },
  limits: { not_to_exceed: null },
  extras: {}, extraction: { model: "m", extracted_at: "2026-09-09T13:12:00.000Z", required_missing: [], notes: null },
});

// A scripted FieldPulse: each entry is [method path-prefix, response]. Records every call.
function fakeFP(script: Array<[string, unknown]>) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const path = url.replace("https://fp.test/v2.5", "");
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method: init.method!, path, body });
    const idx = script.findIndex(([k]) => `${init.method} ${path}`.startsWith(k));
    if (idx < 0) return new Response(JSON.stringify({ errors: [`unscripted ${init.method} ${path}`] }), { status: 400 });
    const [, resp] = script.splice(idx, 1)[0];
    return new Response(JSON.stringify({ error: false, response: resp }), { status: 200 });
  }) as unknown as typeof fetch;
  return { client: new FieldPulseClient({ baseUrl: "https://fp.test/v2.5", apiKey: "k", fetchFn, log: () => {} }), calls };
}
const ids = { portal_reference: 1, portal: 2, portal_priority: 3, nte: 4, portal_store_id: 5 };

describe("deliverRecord", () => {
  it("creates customer (with the store inline) and job on an empty account", async () => {
    const { client, calls } = fakeFP([
      ["GET /job?search=", []],
      ["GET /customer?search=", []],
      ["POST /customer", { id: 10, company_name: "H-E-B", locations: [{ id: 20, title: "770 KERR1 KERRVILLE 01 MAIN/HAYS ST #770.0" }] }],
      ["POST /job", { id: 30, cuid: 1001, status: 1 }],
    ]);
    const store = new MemoryDeliveryStore();
    const r = await deliverRecord(rec, { client, fieldIds: ids, store, log: () => {} });
    expect(r).toMatchObject({ outcome: "created", fp_customer_id: 10, fp_location_id: 20, fp_job_id: 30, fp_job_cuid: "1001", created_customer: true, created_location: true });
    const job = calls.find((c) => c.path === "/job" && c.method === "POST")!.body as any;
    expect(job).toMatchObject({ customer_id: 10, location_id: 20, job_type: "Lighting", billing: 1, status: 1 });
    expect(job.customfields).toEqual([{ field_instance_id: 1, value: "WO-2602977" }, { field_instance_id: 2, value: "heb" }, { field_instance_id: 3, value: "24 hours (Next Business Day)" }, { field_instance_id: 5, value: "770.0" }]);
    expect(store.rows[0]).toMatchObject({ status: "delivered", reference: "WO-2602977" });
    const cust = calls.find((c) => c.path === "/customer" && c.method === "POST")!.body as any;
    expect(cust.locations[0]).toMatchObject({ object_type: CUSTOMER_MORPH_CLASS, title: "770 KERR1 KERRVILLE 01 MAIN/HAYS ST #770.0" });
  });

  it("reuses an existing customer and location found by store id", async () => {
    const { client, calls } = fakeFP([
      ["GET /job?search=", []],
      ["GET /customer?search=", [{ id: 10, company_name: "H-E-B" }]],
      ["GET /location?", [{ id: 21, object_id: 10, title: "770 KERR1 KERRVILLE 01 MAIN/HAYS ST #770.0", address_1: "300 Main St" }]],
      ["POST /job", { id: 31, cuid: 1002 }],
    ]);
    const r = await deliverRecord(rec, { client, fieldIds: ids, store: new MemoryDeliveryStore(), log: () => {} });
    expect(r).toMatchObject({ outcome: "created", fp_customer_id: 10, fp_location_id: 21, created_customer: false, created_location: false });
    expect(calls.some((c) => c.method === "POST" && c.path === "/customer")).toBe(false);
  });

  it("creates the location under an existing customer when no store matches", async () => {
    const { client, calls } = fakeFP([
      ["GET /job?search=", []],
      ["GET /customer?search=", [{ id: 10, company_name: "H-E-B" }]],
      ["GET /location?", [{ id: 22, object_id: 10, title: "Other store #1", address_1: "1 Elsewhere" }]],
      ["POST /location", { id: 23, title: "x" }],
      ["POST /job", { id: 32, cuid: 1003 }],
    ]);
    const r = await deliverRecord(rec, { client, fieldIds: ids, store: new MemoryDeliveryStore(), log: () => {} });
    expect(r).toMatchObject({ fp_location_id: 23, created_location: true });
    expect(calls.find((c) => c.method === "POST" && c.path === "/location")!.body).toMatchObject({ object_type: CUSTOMER_MORPH_CLASS, object_id: 10, title: "770 KERR1 KERRVILLE 01 MAIN/HAYS ST #770.0" });
  });

  it("stops when FieldPulse already has a job for the reference", async () => {
    const { client, calls } = fakeFP([["GET /job?search=", [{ id: 99, cuid: 1000, subtitle: "WO-2602977 · Outside light", customer_id: 10 }]]]);
    const store = new MemoryDeliveryStore();
    const r = await deliverRecord(rec, { client, fieldIds: ids, store, log: () => {} });
    expect(r.outcome).toBe("found_in_fieldpulse");
    expect(r.fp_job_cuid).toBe("1000");
    expect(calls.length).toBe(1);
    expect(store.rows[0].status).toBe("delivered");
  });

  it("stops when our ledger already has the reference", async () => {
    const { client, calls } = fakeFP([]);
    const store = new MemoryDeliveryStore();
    store.rows.push({ run_id: null, customer_id: "dev", reference: "WO-2602977", status: "delivered", fp_customer_id: 1, fp_location_id: 2, fp_job_id: 3, fp_job_cuid: "1000", created_customer: false, created_location: false, request: null, response: null, error: null });
    const r = await deliverRecord(rec, { client, fieldIds: ids, store, log: () => {} });
    expect(r.outcome).toBe("already_delivered");
    expect(calls.length).toBe(0);
  });

  it("records a failed delivery with FieldPulse's error and rethrows", async () => {
    const { client } = fakeFP([
      ["GET /job?search=", []],
      ["GET /customer?search=", []],
      ["POST /customer", { id: 10, locations: [{ id: 20, title: "t" }] }],
    ]);
    const store = new MemoryDeliveryStore();
    await expect(deliverRecord(rec, { client, fieldIds: ids, store, log: () => {} })).rejects.toThrow(/unscripted POST \/job/);
    expect(store.rows[0]).toMatchObject({ status: "failed" });
    expect(store.rows[0].error).toContain("unscripted POST /job");
  });
});
