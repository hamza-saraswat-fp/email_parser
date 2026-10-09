import { describe, it, expect } from "vitest";
import { customerPayload, locationPayload, jobPayload, jobSubtitle, locationTitle } from "./mapping.js";
import { serviceRequestSchema } from "../schema/record.js";

const rec = serviceRequestSchema.parse({
  schema_version: "1.0", record_type: "service_request", customer_id: "dev",
  source: { portal: "servicechannel", sender_email: "x@scalert.com", subject: "New Service Request | 363163523", message_id: "m", received_at: "2026-09-09T13:12:00.000Z" },
  email_type: "new_request",
  reference: { primary: "363163523", all: [{ label: "PO#", value: "363163523" }, { label: "Tracking Number", value: "363163523" }] },
  requester: { organization: "TOPS MARKETS", contact_name: "Randy Ratajczak", contact_email: "r@tops.com", contact_phone: "716-635-1400" },
  site: { name: "ROBINSON RD", identifier: "207", address: { line1: "3035 NIAGARA FALLS BLVD.", line2: null, city: "Amherst", state: "NY", postal_code: "14228", country: null }, phone: "7165150025" },
  work: { trade: "LIGHTING INTERIOR", category: "REPAIR", area: "BACKROOM", asset: "Low ceiling", description: "Light bulb is out\n\nBACKROOM / Lighting / Old bank light very dim." },
  priority: { raw: "Scheduled Maintenance" },
  deadlines: { accept_by: null, on_site_by: null, complete_by: null, scheduled_for: "2027-02-24T08:51:00" },
  limits: { not_to_exceed: { amount: 1000, currency: "USD", raw: "1000.00" } },
  extras: {},
  extraction: { model: "m", extracted_at: "2026-09-09T13:12:00.000Z", required_missing: [], notes: null },
});

describe("mapping", () => {
  it("builds the customer from the organization and the first store address", () => {
    expect(customerPayload(rec)).toMatchObject({ company_name: "TOPS MARKETS", account_type: "company", status: "current customer", phone: "716-635-1400", email: "r@tops.com", address_1: "3035 NIAGARA FALLS BLVD.", city: "Amherst", state: "NY", zip_code: "14228" });
  });
  it("names the location with the store id and carries the address", () => {
    expect(locationTitle(rec)).toBe("ROBINSON RD #207");
    expect(locationPayload(rec)).toMatchObject({ title: "ROBINSON RD #207", address_1: "3035 NIAGARA FALLS BLVD.", city: "Amherst", state: "NY", zip_code: "14228" });
    expect(locationPayload(rec).notes).toContain("7165150025");
  });
  it("puts the reference first in the subtitle so job search can find it", () => {
    expect(jobSubtitle(rec).startsWith("363163523 · Light bulb is out")).toBe(true);
    expect(jobSubtitle(rec).length).toBeLessThanOrEqual(150);
  });
  it("builds the job with required fields, verbatim notes and custom fields by instance id", () => {
    const j = jobPayload(rec, 10, 20, { portal_reference: 1, portal: 2, portal_priority: 3, nte: 4, portal_store_id: 5 });
    expect(j).toMatchObject({ customer_id: 10, location_id: 20, job_type: "LIGHTING INTERIOR", billing: 1, status: 1, type: "job", start_time: Math.floor(Date.parse("2027-02-24T08:51:00") / 1000) });
    expect(j.notes).toContain("Light bulb is out\n\nBACKROOM / Lighting / Old bank light very dim.");
    expect(j.notes).toContain("PO#: 363163523");
    expect(j.notes).toContain("NTE: 1000.00");
    expect(j.customfields).toEqual([
      { field_instance_id: 1, value: "363163523" }, { field_instance_id: 2, value: "servicechannel" }, { field_instance_id: 3, value: "Scheduled Maintenance" }, { field_instance_id: 4, value: 1000 }, { field_instance_id: 5, value: "207" },
    ]);
  });
  it("skips custom fields with no id or no value, and omits start_time without a date", () => {
    const noNte = { ...rec, limits: { not_to_exceed: null }, deadlines: { ...rec.deadlines, scheduled_for: null } };
    const j = jobPayload(noNte, 10, null, { portal_reference: 1 });
    expect(j.customfields).toEqual([{ field_instance_id: 1, value: "363163523" }]);
    expect(j.location_id).toBeUndefined();
    expect("start_time" in j).toBe(false);
  });
});
