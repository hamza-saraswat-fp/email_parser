// The universal service-request record: what the pipeline hands to the
// FieldPulse step. Values are copied verbatim from the email; the only
// normalization is amounts (number) and dates (ISO 8601).
import { z } from "zod";

// Models often emit "" or omit a field instead of null. Normalize all of those
// to null so downstream code has one shape to check.
const ns = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim() ? v.trim() : null));

// Readers assemble the description from several labelled fields and are not
// consistent about it: a paragraph wrapped in quotes one run and bare the next,
// or the same text repeated under two labels. Make that deterministic here.
export function tidyDescription(text: string): string {
  const norm = (p: string) => p.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.trim().replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, "").trim())
    .filter(Boolean);
  const kept: string[] = [];
  for (const p of paras) {
    const n = norm(p);
    if (!n) continue;
    if (kept.some((k) => norm(k).includes(n))) continue;            // already covered by an earlier paragraph
    const idx = kept.findIndex((k) => n.includes(norm(k)));          // this one covers an earlier, shorter paragraph
    if (idx >= 0) kept[idx] = p; else kept.push(p);
  }
  return kept.join("\n\n");
}

export const PORTALS = ["servicechannel", "corrigo", "heb", "fexa", "servicepower", "other"] as const;
export const portalSchema = z.enum(PORTALS);
export type Portal = z.infer<typeof portalSchema>;

export const EMAIL_TYPES = ["new_request", "update", "cancellation", "reminder", "other"] as const;
export const emailTypeSchema = z.enum(EMAIL_TYPES);
export type EmailType = z.infer<typeof emailTypeSchema>;

export const addressSchema = z.object({
  line1: ns,
  line2: ns,
  city: ns,
  state: ns,
  postal_code: ns,
  country: ns,
});

// What the extraction model returns. Everything else on the record is added by code.
export const extractedSchema = z.object({
  reference: z.object({
    primary: ns,
    all: z
      .array(z.object({ label: z.string(), value: z.string() }))
      .nullish()
      .transform((v) => v ?? []),
  }),
  requester: z.object({
    organization: ns,
    contact_name: ns,
    contact_email: ns,
    contact_phone: ns,
  }),
  site: z.object({
    name: ns,
    identifier: ns,
    address: addressSchema,
    phone: ns,
  }),
  work: z.object({
    trade: ns,
    category: ns,
    area: ns,
    asset: ns,
    description: ns.transform((v) => (v ? tidyDescription(v) : v)),
  }),
  priority: z.object({ raw: ns }),
  deadlines: z.object({
    accept_by: ns,
    on_site_by: ns,
    complete_by: ns,
    scheduled_for: ns,
  }),
  limits: z.object({
    not_to_exceed: z
      .object({
        amount: z.number().nullish().transform((v) => v ?? null),
        currency: ns,
        raw: ns,
      })
      .nullish()
      .transform((v) => v ?? null),
  }),
  // Models emit null (or "") for a labelled-but-blank field such as "Asset
  // Serial Number:". Drop those rather than failing the whole extraction.
  extras: z
    .record(z.string().nullable())
    .nullish()
    .transform((v) => {
      const out: Record<string, string> = {};
      for (const [k, val] of Object.entries(v ?? {})) if (val && val.trim()) out[k] = val.trim();
      return out;
    }),
  notes: ns,
});
export type Extracted = z.infer<typeof extractedSchema>;

export const serviceRequestSchema = extractedSchema.omit({ notes: true }).extend({
  schema_version: z.literal("1.0"),
  record_type: z.literal("service_request"),
  customer_id: z.string(),
  source: z.object({
    portal: portalSchema,
    sender_email: ns,
    subject: ns,
    message_id: z.string(),
    received_at: z.string(),
  }),
  email_type: emailTypeSchema,
  extraction: z.object({
    model: z.string(),
    extracted_at: z.string(),
    required_missing: z.array(z.string()),
    notes: ns,
  }),
});
export type ServiceRequest = z.infer<typeof serviceRequestSchema>;

// Default required fields. "a|b" means either path satisfies the requirement.
export const DEFAULT_REQUIRED_FIELDS = [
  "reference.primary",
  "site.address.line1|site.name",
  "work.description",
];
