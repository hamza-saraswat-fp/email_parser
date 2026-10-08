// The pipeline. One run per inbound email; every step is recorded before the
// next one starts, so a failed run still shows where it stopped.
//
//   received -> cleaned -> classified -> extracted -> checked
//
// Pure of transport: the listener, the catch-up path and the replay script all
// call processInbound() with the same InboundEmail shape and a RunStore.
import { cleanEmail } from "../email/clean.js";
import { classifyEmail } from "./classify.js";
import { extractRecord } from "./extract.js";
import { checkRequired } from "./check.js";
import { portalFromBody, portalFromSender } from "./portal.js";
import { serviceRequestSchema, type ServiceRequest, type Portal, type EmailType } from "../schema/record.js";
import type { ChatJsonFn } from "../llm/openrouter.js";
import type { Customer, InboundEmail, RunStore, RunSummary, StepRow } from "./types.js";

export interface PipelineDeps {
  chat?: ChatJsonFn;
  log?: (line: string) => void;
  // Per-step model overrides (replay comparisons). Unset = config defaults.
  models?: { classify?: string; extract?: string };
}

class StepFailed extends Error {
  constructor(public step: string, cause: unknown) {
    super(`${step}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

export async function processInbound(
  email: InboundEmail,
  customer: Customer,
  store: RunStore,
  deps: PipelineDeps = {},
): Promise<RunSummary | null> {
  const log = deps.log ?? ((line: string) => console.log(line));

  // received: store the raw email, dedupe on message_id.
  const stored = await store.storeEmail(email, customer.id);
  if (stored.duplicate) {
    log(`[RUN] duplicate message_id ${email.message_id} -- skipping`);
    return null;
  }
  const runId = await store.createRun(stored.id, customer.id);
  // Prefix on the run id, not the message id: AgentMail message ids share a
  // long common prefix, so two concurrent runs were indistinguishable in logs.
  const prefix = `[RUN ${runId.slice(0, 8)}]`;
  log(`${prefix} started (customer=${customer.id}, from=${email.from_email ?? "?"}, subject="${email.subject ?? ""}")`);

  let position = 0;
  async function step<T>(name: string, input: unknown, fn: () => Promise<T>): Promise<T> {
    position += 1;
    const t0 = Date.now();
    try {
      const output = await fn();
      await store.addStep(runId, {
        position, name, status: "ok", input, output, error: null, duration_ms: Date.now() - t0,
      } satisfies StepRow);
      log(`${prefix} ${name} ok (${Date.now() - t0}ms)`);
      return output;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await store.addStep(runId, {
        position, name, status: "failed", input, output: null, error: message, duration_ms: Date.now() - t0,
      } satisfies StepRow);
      throw new StepFailed(name, err);
    }
  }

  let emailType: EmailType | null = null;
  let portal: Portal | null = null;
  let confidence: number | null = null;

  try {
    await step("received", { message_id: email.message_id, inbox_id: email.inbox_id, from: email.from_email, subject: email.subject, attachments: email.attachments.length }, async () => ({
      email_id: stored.id,
      has_html: Boolean(email.html),
      has_text: Boolean(email.text),
      attachments: email.attachments,
    }));

    const cleaned = await step("cleaned", { html_chars: email.html?.length ?? 0, text_chars: email.text?.length ?? 0 }, async () => {
      const { body, source } = cleanEmail({ text: email.text, html: email.html });
      if (!body) throw new Error("email has no readable body");
      return { source, chars: body.length, body };
    });

    const portalHint = portalFromSender(email.from_email) ?? portalFromBody(cleaned.body);

    const classified = await step("classified", { portal_hint: portalHint, from: email.from_email, subject: email.subject }, async () => {
      const { result, model } = await classifyEmail(
        { from: email.from_email, subject: email.subject, body: cleaned.body, portalHint },
        deps.chat,
        deps.models?.classify,
      );
      return { ...result, model };
    });
    emailType = classified.email_type;
    portal = classified.portal;
    confidence = classified.confidence;

    if (classified.email_type !== "new_request") {
      await store.finishRun(runId, { status: "skipped", email_type: emailType, portal, confidence });
      log(`${prefix} skipped: ${classified.email_type} (${classified.reason})`);
      return { run_id: runId, status: "skipped", email_type: emailType, portal, required_missing: [], record: null, error: null };
    }

    const extracted = await step("extracted", { portal, received_at: email.received_at, body_chars: cleaned.body.length }, async () => {
      const { result, model, usage } = await extractRecord(
        { from: email.from_email, subject: email.subject, receivedAt: email.received_at, body: cleaned.body, portalHint: portal },
        deps.chat,
        deps.models?.extract,
      );
      return { model, usage, extracted: result };
    });

    const { notes, ...fields } = extracted.extracted;
    const record: ServiceRequest = serviceRequestSchema.parse({
      ...fields,
      schema_version: "1.0",
      record_type: "service_request",
      customer_id: customer.id,
      source: {
        portal,
        sender_email: email.from_email,
        subject: email.subject,
        message_id: email.message_id,
        received_at: email.received_at,
      },
      email_type: emailType,
      extraction: { model: extracted.model, extracted_at: new Date().toISOString(), required_missing: [], notes },
    });

    const checked = await step("checked", { required_fields: customer.required_fields }, async () => {
      const missing = checkRequired(record, customer.required_fields);
      return { required_missing: missing, status: missing.length ? "needs_review" : "ready" };
    });
    record.extraction.required_missing = checked.required_missing;

    await store.storeRecord(runId, customer.id, record, checked.required_missing);
    const status = checked.required_missing.length ? "needs_review" : "ready";
    await store.finishRun(runId, { status, email_type: emailType, portal, confidence });
    log(`${prefix} ${status}${checked.required_missing.length ? ` (missing: ${checked.required_missing.join(", ")})` : ""}`);
    return { run_id: runId, status, email_type: emailType, portal, required_missing: checked.required_missing, record, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await store.finishRun(runId, { status: "failed", email_type: emailType, portal, confidence, error: message });
    log(`${prefix} failed: ${message}`);
    return { run_id: runId, status: "failed", email_type: emailType, portal, required_missing: [], record: null, error: message };
  }
}
