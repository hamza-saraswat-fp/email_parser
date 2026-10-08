// Step 5: the deterministic judge. Every value the reader produced must come
// from the email. No model, no network; a pure function.
import type { ServiceRequest } from "../schema/record.js";

export interface VerifyFailure {
  field: string;
  rule: "not_in_email" | "reference_not_in_subject" | "format" | "amount_not_in_email" | "date_out_of_window" | "date_unparseable";
  value: string;
}

export const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const DAY = 86_400_000;

export function verifyRecord(record: ServiceRequest, body: string, subject: string | null, receivedAt: string): VerifyFailure[] {
  const failures: VerifyFailure[] = [];
  const haystack = normalize(`${subject ?? ""}\n${body}`);
  const subj = normalize(subject ?? "");
  const inEmail = (v: string) => haystack.includes(normalize(v));

  const verbatim: Array<[string, string | null]> = [
    ["reference.primary", record.reference.primary],
    ["requester.organization", record.requester.organization],
    ["requester.contact_name", record.requester.contact_name],
    ["site.name", record.site.name],
    ["site.identifier", record.site.identifier],
    ["site.address.line1", record.site.address.line1],
    ["site.address.city", record.site.address.city],
    ["site.address.postal_code", record.site.address.postal_code],
    ["site.phone", record.site.phone],
    ["work.trade", record.work.trade],
    ["work.area", record.work.area],
    ["priority.raw", record.priority.raw],
    ["limits.not_to_exceed.raw", record.limits.not_to_exceed?.raw ?? null],
  ];
  for (const [field, value] of verbatim) {
    if (value && !inEmail(value)) failures.push({ field, rule: "not_in_email", value });
  }
  // The description may be several free-text fields joined by blank lines; each
  // paragraph must appear on its own.
  for (const [i, para] of (record.work.description ?? "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).entries()) {
    if (!inEmail(para)) failures.push({ field: `work.description[${i}]`, rule: "not_in_email", value: para.slice(0, 80) });
  }
  for (const [label, value] of Object.entries(record.extras)) {
    if (value && !inEmail(value)) failures.push({ field: `extras.${label}`, rule: "not_in_email", value });
  }

  // Reference in subject. A soft rule on its own (some portals may leave it
  // out); it hardens into a failure only when the reference is also absent from
  // the body, which the verbatim check above already reports.
  const ref = record.reference.primary;
  if (ref && !subj.includes(normalize(ref)) && !inEmail(ref)) {
    failures.push({ field: "reference.primary", rule: "reference_not_in_subject", value: ref });
  }

  // Formats.
  const zip = record.site.address.postal_code;
  if (zip && !/^\d{5}(-\d{4})?$/.test(zip.trim())) failures.push({ field: "site.address.postal_code", rule: "format", value: zip });
  const state = record.site.address.state;
  const country = record.site.address.country;
  if (state && (!country || /^(us|usa|united states)$/i.test(country)) && !/^[A-Za-z]{2}$/.test(state.trim())) {
    failures.push({ field: "site.address.state", rule: "format", value: state });
  }
  for (const [field, phone] of [["site.phone", record.site.phone], ["requester.contact_phone", record.requester.contact_phone]] as const) {
    if (phone && phone.replace(/\D/g, "").length < 10) failures.push({ field, rule: "format", value: phone });
  }

  // NTE amount must match a money figure that appears in the text.
  const nte = record.limits.not_to_exceed;
  if (nte?.amount != null) {
    const amounts = new Set((body.match(/\d[\d,]*(?:\.\d{1,2})?/g) ?? []).map((m) => Number(m.replace(/,/g, ""))));
    if (!amounts.has(nte.amount)) failures.push({ field: "limits.not_to_exceed.amount", rule: "amount_not_in_email", value: String(nte.amount) });
  }

  // Dates must parse and sit in a plausible window around receipt.
  const received = Date.parse(receivedAt);
  const lo = received - 30 * DAY;
  const hi = received + 400 * DAY;
  for (const [k, v] of Object.entries(record.deadlines)) {
    if (!v) continue;
    const t = Date.parse(v);
    if (Number.isNaN(t)) failures.push({ field: `deadlines.${k}`, rule: "date_unparseable", value: v });
    else if (t < lo || t > hi) failures.push({ field: `deadlines.${k}`, rule: "date_out_of_window", value: v });
  }
  return failures;
}
