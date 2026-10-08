import { describe, it, expect } from "vitest";
import { semanticChecks } from "./semantic.js";
import { serviceRequestSchema } from "../schema/record.js";
import type { AskJevFn } from "../llm/jev.js";

const rec = serviceRequestSchema.parse({
  schema_version: "1.0", record_type: "service_request", customer_id: "dev",
  source: { portal: "heb", sender_email: null, subject: "s", message_id: "m", received_at: "2026-09-09T13:12:00.000Z" },
  email_type: "new_request",
  reference: { primary: "WO-1", all: [] },
  requester: { organization: "H-E-B", contact_name: null, contact_email: null, contact_phone: null },
  site: { name: "770 KERR", identifier: "770", address: { line1: "300 Main St", line2: null, city: "Kerrville", state: "TX", postal_code: "78028", country: null }, phone: null },
  work: { trade: "Lighting", category: null, area: null, asset: null, description: "Outside light is out." },
  priority: { raw: null },
  deadlines: { accept_by: null, on_site_by: null, complete_by: null, scheduled_for: null },
  limits: { not_to_exceed: null },
  extras: {},
  extraction: { model: "m", extracted_at: "2026-09-09T13:12:00.000Z", required_missing: [], notes: null },
});

function fake(values: Record<string, number>): AskJevFn {
  return async (_state, questions) => ({
    model: "typesafe-ai/jev", usage: null,
    answers: Object.fromEntries(Object.keys(questions).map((id) => [id, { type: "boolean" as const, boolean: values[id] ?? 0.9 }])),
  });
}

describe("semanticChecks", () => {
  it("asks only about fields that are present and passes when all are high", async () => {
    let asked: string[] = [];
    const ask: AskJevFn = async (s, q) => { asked = Object.keys(q); return fake({})(s, q); };
    const r = await semanticChecks(rec, "email text", 0.7, ask);
    expect(asked).toEqual(["description_is_the_problem", "address_is_the_site", "reference_is_the_lookup_number"]);
    expect(r.failures).toEqual([]);
    expect(r.scores.priority_is_the_priority).toBeNull();
  });
  it("names the question that fell below the threshold", async () => {
    const r = await semanticChecks(rec, "email text", 0.7, fake({ address_is_the_site: 0.3 }));
    expect(r.failures).toEqual(["address_is_the_site: 0.30 (min 0.7)"]);
    expect(r.scores.address_is_the_site).toBe(0.3);
  });
});
