// Step: pull the values out of a new request into the universal record shape.
// One general reader for any portal; no template per portal.
import { extractedSchema, type Extracted } from "../schema/record.js";
import { chatJson, stripFences, type ChatJsonFn } from "../llm/openrouter.js";

export function buildExtractSystemPrompt(): string {
  return `You extract structured data from ONE work-order / service-request email sent to a field-service contractor by a portal (ServiceChannel, Corrigo, H-E-B My Facility, FEXA, ServicePower, or similar). The layout and labels differ by portal; the information is the same. Return STRICT JSON only, matching the shape below exactly. Use null for anything the email does not state. NEVER invent, guess, or rewrite a value: copy text exactly as written (trim surrounding whitespace only).

{
  "reference": {
    "primary": "the main work order / service request / PO number the contractor would use to look this request up",
    "all": [ {"label": "label as written, e.g. PO#", "value": "number as written"} ]   // every reference number in the email, including duplicates under different labels
  },
  "requester": {
    "organization": "the end customer / client company that owns the site (e.g. TOPS MARKETS, H-E-B, Albertsons Companies)",
    "contact_name": "person to contact at the site or client, if named",
    "contact_email": null, "contact_phone": null
  },
  "site": {
    "name": "store / location name as written",
    "identifier": "store number / location id / location number, as written",
    "address": {"line1": null, "line2": null, "city": null, "state": null, "postal_code": null, "country": null},
    "phone": "the site's phone number"
  },
  "work": {
    "trade": "trade / issue type / problem type (e.g. LIGHTING INTERIOR, Lighting)",
    "category": "category / type if given (e.g. REPAIR, Reactive, Scheduled Maintenance)",
    "area": "area within the site (e.g. BACKROOM, Wareroom, PRODUCE)",
    "asset": "asset / equipment named, if any",
    "description": "the problem description / work order description VERBATIM, including notes about the problem. Join multiple description fields with a blank line. Do not summarize."
  },
  "priority": {"raw": "priority exactly as written (e.g. 'Scheduled Maintenance', '24 hours (Next Business Day)', 'REGULAR (ON-SITE W/I 48 BUSINESS HOURS)')"},
  "deadlines": {
    "accept_by": "ISO 8601 datetime if the email states a deadline to accept/reject, else null",
    "on_site_by": "ISO 8601 if stated",
    "complete_by": "ISO 8601 if stated",
    "scheduled_for": "ISO 8601 if a scheduled date/time is stated"
  },
  "limits": {
    "not_to_exceed": {"amount": 1500.00, "currency": "USD", "raw": "the NTE / 'do not exceed' text as written"}   // or null when the email has no NTE
  },
  "extras": { "Label as written": "value as written" },   // every other labelled value you did not place above (e.g. Department, Region, District, Fax, IVR code, Created By). Never include passwords or PINs.
  "notes": "one short sentence on anything ambiguous, or null"
}

Rules:
- Dates: write ISO 8601 (YYYY-MM-DDTHH:MM:SS). If the email gives a date with no time, use T00:00:00. If only a relative deadline is given (e.g. 'within 5 business days'), leave the deadline null and put the text in extras.
- Amounts: numeric amount without currency symbols or thousands separators; currency as a 3-letter code when it can be inferred (USD for $), else null.
- If the email is a manual forward ("---------- Forwarded message ----------"), extract from the ORIGINAL message, not the forwarding wrapper.
- Buttons, links, app-store banners, legal footers and check-in instructions are not data; ignore them (but a PIN or IVR code is data for extras ONLY if it is not a credential -- never include a PIN).
- If two values conflict for the same field (e.g. two different cities), keep the value from the primary/site address field and mention the conflict in notes.

Return ONLY the JSON object. No markdown, no prose.`;
}

export function buildExtractUserMessage(input: {
  from: string | null;
  subject: string | null;
  receivedAt: string;
  body: string;
  portalHint: string | null;
}): string {
  const hint = input.portalHint ? `Portal: ${input.portalHint}\n` : "";
  return `${hint}Received at: ${input.receivedAt}\nFrom: ${input.from ?? "(unknown)"}\nSubject: ${input.subject ?? "(no subject)"}\n\n${input.body.slice(0, 20_000)}`;
}

export async function extractRecord(
  input: { from: string | null; subject: string | null; receivedAt: string; body: string; portalHint: string | null },
  chat: ChatJsonFn = chatJson,
): Promise<{ result: Extracted; model: string; usage: unknown }> {
  const { content, model, usage } = await chat(buildExtractSystemPrompt(), buildExtractUserMessage(input));
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(content));
  } catch {
    throw new Error(`extract: model did not return valid JSON: ${content.slice(0, 200)}`);
  }
  const result = extractedSchema.safeParse(parsed);
  if (!result.success) throw new Error(`extract: ${result.error.message}`);
  return { result: result.data, model, usage };
}
