// Step: decide what kind of email this is. Only new requests go on to extraction.
import { z } from "zod";
import { emailTypeSchema, portalSchema } from "../schema/record.js";
import { chatJson, stripFences, type ChatJsonFn } from "../llm/openrouter.js";
import { config } from "../config.js";

export const classificationSchema = z.object({
  email_type: emailTypeSchema,
  portal: portalSchema,
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});
export type Classification = z.infer<typeof classificationSchema>;

export function buildClassifySystemPrompt(): string {
  return `You classify ONE email received by a field-service contractor. The email was sent by a work-order portal (ServiceChannel, Corrigo / CorrigoPro, H-E-B My Facility, FEXA, ServicePower, or a similar system), possibly forwarded. You never write a reply. Return STRICT JSON only.

email_type (pick exactly one):
- "new_request": a NEW service request / work order being dispatched or assigned to the contractor. It describes a site and a problem to fix. Accept/decline buttons or links are typical.
- "update": a change to a request already sent (reassignment, updated details, status change, approval, note added, proposal response).
- "cancellation": the request is cancelled, declined, closed, or recalled.
- "reminder": a nudge about an existing request (no response yet, acceptance overdue, check-in reminder, escalation) with no new work.
- "other": anything else (invoices, payment notices, newsletters, system notices, spam, unrelated mail).

portal (pick exactly one): "servicechannel", "corrigo", "heb", "fexa", "servicepower", "other". Use the ORIGINAL sender and the layout. If the email was forwarded, look inside the forwarded header.

confidence: 0..1 for email_type. reason: one short sentence.

Return ONLY: {"email_type": ..., "portal": ..., "confidence": ..., "reason": ...}`;
}

export function buildClassifyUserMessage(input: {
  from: string | null;
  subject: string | null;
  body: string;
  portalHint: string | null;
}): string {
  const hint = input.portalHint ? `Sender domain suggests portal: ${input.portalHint}\n` : "";
  return `${hint}From: ${input.from ?? "(unknown)"}\nSubject: ${input.subject ?? "(no subject)"}\n\n${input.body.slice(0, 12_000)}`;
}

export async function classifyEmail(
  input: { from: string | null; subject: string | null; body: string; portalHint: string | null },
  chat: ChatJsonFn = chatJson,
  modelId: string = config.OPENROUTER_MODEL_CLASSIFY,
): Promise<{ result: Classification; model: string }> {
  const { content, model } = await chat(buildClassifySystemPrompt(), buildClassifyUserMessage(input), { model: modelId });
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(content));
  } catch {
    throw new Error(`classify: model did not return valid JSON: ${content.slice(0, 200)}`);
  }
  const result = classificationSchema.safeParse(parsed);
  if (!result.success) throw new Error(`classify: ${result.error.message}`);
  return { result: result.data, model };
}
