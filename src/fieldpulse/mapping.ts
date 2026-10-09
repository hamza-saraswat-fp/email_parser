// Universal record -> FieldPulse payloads. Pure functions; values are copied
// verbatim from the record, which the pipeline already verified against the
// email. Nothing here invents or rewrites text.
import type { ServiceRequest } from "../schema/record.js";

// The five job custom fields the parser needs. FieldPulse has no native slot
// for any of them. Widget ids follow the seed order: 1 text, 2 number.
export const JOB_CUSTOM_FIELDS = [
  { key: "portal_reference", name: "Portal Reference", widget: 1 },
  { key: "portal", name: "Portal", widget: 1 },
  { key: "portal_priority", name: "Portal Priority", widget: 1 },
  { key: "nte", name: "NTE", widget: 2 },
  { key: "portal_store_id", name: "Portal Store ID", widget: 1 },
] as const;
export type FieldKey = (typeof JOB_CUSTOM_FIELDS)[number]["key"];
export type FieldIds = Partial<Record<FieldKey, number>>;

export const normalizeName = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function locationTitle(r: ServiceRequest): string {
  const name = r.site.name?.trim();
  const id = r.site.identifier?.trim();
  if (name && id && !name.includes(id)) return `${name} #${id}`;
  if (name) return name;
  if (id) return `Store #${id}`;
  return r.site.address.line1?.trim() || "Service site";
}

export function locationPayload(r: ServiceRequest) {
  const a = r.site.address;
  return {
    title: locationTitle(r).slice(0, 255),
    address_1: a.line1 ?? undefined,
    address_2: a.line2 ?? undefined,
    city: a.city ?? undefined,
    state: a.state ?? undefined,
    zip_code: a.postal_code ?? undefined,
    notes: [r.site.phone ? `Site phone: ${r.site.phone}` : null, r.site.identifier ? `Portal store id: ${r.site.identifier}` : null].filter(Boolean).join("\n") || undefined,
  };
}

export function customerPayload(r: ServiceRequest) {
  const org = r.requester.organization?.trim() || locationTitle(r);
  const a = r.site.address;
  return {
    company_name: org.slice(0, 255),
    account_type: "company" as const,
    status: "current customer" as const,
    phone: r.requester.contact_phone ?? undefined,
    email: r.requester.contact_email ?? undefined,
    // The customer's own address is the first store we see; later stores are locations.
    address_1: a.line1 ?? undefined,
    city: a.city ?? undefined,
    state: a.state ?? undefined,
    zip_code: a.postal_code ?? undefined,
    notes: `Created by the email parser from a ${r.source.portal} email.`,
  };
}

export function jobSubtitle(r: ServiceRequest): string {
  const ref = r.reference.primary ?? "";
  const desc = (r.work.description ?? "").split(/\s+/).slice(0, 12).join(" ");
  const s = [ref, desc].filter(Boolean).join(" · ");
  return (s || locationTitle(r)).slice(0, 150);
}

export function jobNotes(r: ServiceRequest): string {
  const lines: string[] = [];
  if (r.work.description) lines.push(r.work.description.trim(), "");
  lines.push(`Portal: ${r.source.portal}`);
  for (const ref of r.reference.all.length ? r.reference.all : r.reference.primary ? [{ label: "Reference", value: r.reference.primary }] : []) {
    lines.push(`${ref.label}: ${ref.value}`);
  }
  if (r.priority.raw) lines.push(`Priority: ${r.priority.raw}`);
  if (r.limits.not_to_exceed?.raw) lines.push(`NTE: ${r.limits.not_to_exceed.raw}`);
  for (const [k, v] of Object.entries(r.deadlines)) if (v) lines.push(`${k.replace(/_/g, " ")}: ${v}`);
  if (r.work.area) lines.push(`Area: ${r.work.area}`);
  if (r.work.asset) lines.push(`Asset: ${r.work.asset}`);
  if (r.work.category) lines.push(`Category: ${r.work.category}`);
  if (r.site.phone) lines.push(`Site phone: ${r.site.phone}`);
  const contact = [r.requester.contact_name, r.requester.contact_phone, r.requester.contact_email].filter(Boolean).join(" · ");
  if (contact) lines.push(`Requester contact: ${contact}`);
  if (r.source.subject) lines.push(`Email subject: ${r.source.subject}`);
  return lines.join("\n").slice(0, 20000);
}

function toUnix(iso: string | null): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : Math.floor(t / 1000);
}

export function jobPayload(r: ServiceRequest, customerId: number, locationId: number | null, fieldIds: FieldIds) {
  const values: Record<FieldKey, string | number | null> = {
    portal_reference: r.reference.primary,
    portal: r.source.portal,
    portal_priority: r.priority.raw,
    nte: r.limits.not_to_exceed?.amount ?? null,
    portal_store_id: r.site.identifier,
  };
  const customfields = (Object.keys(values) as FieldKey[])
    .filter((k) => fieldIds[k] != null && values[k] != null && values[k] !== "")
    .map((k) => ({ field_instance_id: fieldIds[k]!, value: values[k] }));
  const start = toUnix(r.deadlines.scheduled_for);
  return {
    customer_id: customerId,
    location_id: locationId ?? undefined,
    job_type: (r.work.trade?.trim() || "Service Request").slice(0, 150),
    subtitle: jobSubtitle(r),
    notes: jobNotes(r),
    billing: 1,
    status: 1,
    type: "job" as const,
    ...(start ? { start_time: start } : {}),
    customfields,
  };
}
