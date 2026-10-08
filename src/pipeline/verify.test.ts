import { describe, it, expect } from "vitest";
import { verifyRecord } from "./verify.js";
import { serviceRequestSchema } from "../schema/record.js";

const body = `New Service Request
Your company has received a service request #363163523 from CALLER: StoreManager.
Customer
TOPS MARKETS Amherst NY 207
Location Name
ROBINSON RD
Priority
Scheduled Maintenance
NTE
1000.00
Problem Description
"BACKROOM / Lighting / Light bulb is out"
Address
3035 NIAGARA FALLS BLVD.
Amherst NY 14228
Phone
7165150025`;
const subject = "New Service Request | Location ID: 207 | 363163523 | TOPS MARKETS";
const received = "2026-09-09T13:12:00.000Z";

function rec(over: Record<string, unknown> = {}) {
  return serviceRequestSchema.parse({
    schema_version: "1.0", record_type: "service_request", customer_id: "dev",
    source: { portal: "servicechannel", sender_email: null, subject, message_id: "m", received_at: received },
    email_type: "new_request",
    reference: { primary: "363163523", all: [] },
    requester: { organization: "TOPS MARKETS", contact_name: null, contact_email: null, contact_phone: null },
    site: { name: "ROBINSON RD", identifier: "207", address: { line1: "3035 NIAGARA FALLS BLVD.", line2: null, city: "Amherst", state: "NY", postal_code: "14228", country: null }, phone: "7165150025" },
    work: { trade: null, category: null, area: "BACKROOM", asset: null, description: "\"BACKROOM / Lighting / Light bulb is out\"" },
    priority: { raw: "Scheduled Maintenance" },
    deadlines: { accept_by: null, on_site_by: null, complete_by: null, scheduled_for: "2027-02-24T08:51:00" },
    limits: { not_to_exceed: { amount: 1000, currency: "USD", raw: "1000.00" } },
    extras: {},
    extraction: { model: "m", extracted_at: received, required_missing: [], notes: null },
    ...over,
  });
}

describe("verifyRecord", () => {
  it("passes a faithful record", () => {
    expect(verifyRecord(rec(), body, subject, received)).toEqual([]);
  });
  it("flags an invented address", () => {
    const r = rec({ site: { ...rec().site, address: { ...rec().site.address, line1: "99 Fake Street" } } });
    expect(verifyRecord(r, body, subject, received)).toEqual([{ field: "site.address.line1", rule: "not_in_email", value: "99 Fake Street" }]);
  });
  it("flags a description paragraph that is not in the email", () => {
    const r = rec({ work: { ...rec().work, description: "\"BACKROOM / Lighting / Light bulb is out\"\n\nSomething the model made up" } });
    expect(verifyRecord(r, body, subject, received).map((f) => f.field)).toEqual(["work.description[1]"]);
  });
  it("flags an NTE amount that is not in the text, a bad zip, and a date out of window", () => {
    const r = rec({
      limits: { not_to_exceed: { amount: 1500, currency: "USD", raw: "1000.00" } },
      site: { ...rec().site, address: { ...rec().site.address, postal_code: "1422" } },
      deadlines: { ...rec().deadlines, complete_by: "2031-01-01T00:00:00" },
    });
    const rules = verifyRecord(r, body, subject, received).map((f) => `${f.field}:${f.rule}`);
    expect(rules).toContain("limits.not_to_exceed.amount:amount_not_in_email");
    expect(rules).toContain("site.address.postal_code:format");
    expect(rules).toContain("deadlines.complete_by:date_out_of_window");
  });
  it("tolerates punctuation and case differences", () => {
    const r = rec({ site: { ...rec().site, address: { ...rec().site.address, line1: "3035 Niagara Falls Blvd" } } });
    expect(verifyRecord(r, body, subject, received)).toEqual([]);
  });
});
