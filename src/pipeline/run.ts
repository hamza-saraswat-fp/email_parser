// The pipeline. One run per inbound email; every step is recorded before the
// next one starts, so a failed run still shows where it stopped.
//
//   received -> cleaned -> sorted (Jev) -> gate -> extracted (Sonnet) -> verified (code)
//            -> semantic (Jev) -> checked (required fields) -> ready | needs_review
//
// Jev and the reader propose; code decides. Nothing a model says reaches
// "ready" unless the verify step found it in the email and the semantic step
// agreed it means what the record says.
//
// Pure of transport: the listener, the catch-up path and the replay script all
// call processInbound() with the same InboundEmail shape and a RunStore.
import { cleanEmail, focusBody } from "../email/clean.js";
import { sortEmail } from "./sort.js";
import { gate } from "./gate.js";
import { extractRecord } from "./extract.js";
import { verifyRecord } from "./verify.js";
import { semanticChecks } from "./semantic.js";
import { checkRequired } from "./check.js";
import { portalFromBody, portalFromSender } from "./portal.js";
import { serviceRequestSchema, type ServiceRequest, type Portal, type EmailType } from "../schema/record.js";
import { config } from "../config.js";
import type { ChatJsonFn } from "../llm/openrouter.js";
import type { AskJevFn } from "../llm/jev.js";
import { emptyChecks, checksFailed, type Customer, type InboundEmail, type RunStore, type RunSummary, type StepRow, type CheckResults } from "./types.js";

export interface PipelineDeps {
  chat?: ChatJsonFn;
  ask?: AskJevFn;
  log?: (line: string) => void;
  models?: { extract?: string };
  thresholds?: { sort?: number; check?: number };
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
  const sortMin = deps.thresholds?.sort ?? config.JEV_SORT_MIN_CONFIDENCE;
  const checkMin = deps.thresholds?.check ?? config.JEV_CHECK_MIN;

  // received: store the raw email, dedupe on message_id.
  const stored = await store.storeEmail(email, customer.id);
  if (stored.duplicate) {
    log(`[RUN] duplicate message_id ${email.message_id} -- skipping`);
    return null;
  }
  const runId = await store.createRun(stored.id, customer.id);
  const prefix = `[RUN ${runId.slice(0, 8)}]`;
  log(`${prefix} started (customer=${customer.id}, from=${email.from_email ?? "?"}, subject="${email.subject ?? ""}")`);

  let position = 0;
  async function step<T>(name: string, input: unknown, fn: () => Promise<T>): Promise<T> {
    position += 1;
    const t0 = Date.now();
    try {
      const output = await fn();
      await store.addStep(runId, { position, name, status: "ok", input, output, error: null, duration_ms: Date.now() - t0 } satisfies StepRow);
      log(`${prefix} ${name} ok (${Date.now() - t0}ms)`);
      return output;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await store.addStep(runId, { position, name, status: "failed", input, output: null, error: message, duration_ms: Date.now() - t0 } satisfies StepRow);
      throw new StepFailed(name, err);
    }
  }

  let emailType: EmailType | null = null;
  let portal: Portal | null = null;
  let confidence: number | null = null;
  const checks: CheckResults = emptyChecks();
  const summary = (status: RunSummary["status"], record: ServiceRequest | null, error: string | null = null): RunSummary =>
    ({ run_id: runId, status, email_type: emailType, portal, checks, record, error });

  try {
    await step("received", { message_id: email.message_id, inbox_id: email.inbox_id, from: email.from_email, subject: email.subject, attachments: email.attachments.length }, async () => ({
      email_id: stored.id, has_html: Boolean(email.html), has_text: Boolean(email.text), attachments: email.attachments,
    }));

    const cleaned = await step("cleaned", { html_chars: email.html?.length ?? 0, text_chars: email.text?.length ?? 0 }, async () => {
      const { body: full, source } = cleanEmail({ text: email.text, html: email.html });
      if (!full) throw new Error("email has no readable body");
      const body = focusBody(full);
      return { source, chars: body.length, trimmed_forward_wrapper: body.length !== full.length, body };
    });

    const portalHint = portalFromSender(email.from_email) ?? portalFromBody(cleaned.body);

    const sorted = await step("sorted", { portal_hint: portalHint, from: email.from_email, subject: email.subject, min_confidence: sortMin }, async () => {
      const r = await sortEmail({ from: email.from_email, subject: email.subject, body: cleaned.body, portalHint }, deps.ask);
      const decision = gate(r, sortMin);
      return { ...r, decision };
    });
    emailType = sorted.email_type;
    portal = sorted.portal;
    confidence = sorted.email_type_confidence;

    if (sorted.decision.outcome === "skip") {
      await store.finishRun(runId, { status: "skipped", email_type: emailType, portal, confidence });
      log(`${prefix} skipped: ${sorted.decision.reason}`);
      return summary("skipped", null);
    }
    if (sorted.decision.outcome === "review") {
      checks.sort.push(sorted.decision.reason);
      await store.finishRun(runId, { status: "needs_review", email_type: emailType, portal, confidence });
      log(`${prefix} needs_review: ${sorted.decision.reason}`);
      return summary("needs_review", null);
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
      source: { portal, sender_email: email.from_email, subject: email.subject, message_id: email.message_id, received_at: email.received_at },
      email_type: emailType,
      extraction: { model: extracted.model, extracted_at: new Date().toISOString(), required_missing: [], notes },
    });

    const verified = await step("verified", { rules: ["not_in_email", "reference_not_in_subject", "format", "amount_not_in_email", "date_window"] }, async () => {
      const failures = verifyRecord(record, cleaned.body, email.subject, email.received_at);
      return { failures, values_checked: countValues(record) };
    });
    checks.verify.push(...verified.failures.map((f) => `${f.field}: ${f.rule} (${f.value})`));

    const semantic = await step("semantic", { min_score: checkMin }, async () => {
      const r = await semanticChecks(record, cleaned.body, checkMin, deps.ask);
      return { scores: r.scores, failures: r.failures, model: r.model, usage: r.usage };
    });
    checks.semantic.push(...semantic.failures);

    const required = await step("checked", { required_fields: customer.required_fields }, async () => {
      const missing = checkRequired(record, customer.required_fields);
      return { required_missing: missing, all_failures: checksFailed({ ...checks, required: missing }) };
    });
    checks.required.push(...required.required_missing);

    const failed = checksFailed(checks);
    record.extraction.required_missing = failed;
    await store.storeRecord(runId, customer.id, record, checks);
    const status = failed.length ? "needs_review" : "ready";
    await store.finishRun(runId, { status, email_type: emailType, portal, confidence });
    log(`${prefix} ${status}${failed.length ? ` (${failed.join("; ")})` : ""}`);
    return summary(status, record);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await store.finishRun(runId, { status: "failed", email_type: emailType, portal, confidence, error: message });
    log(`${prefix} failed: ${message}`);
    return summary("failed", null, message);
  }
}

function countValues(record: ServiceRequest): number {
  let n = 0;
  const walk = (v: unknown) => {
    if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(walk);
    else if (typeof v === "string" && v) n++;
  };
  walk({ reference: record.reference, requester: record.requester, site: record.site, work: record.work, priority: record.priority, extras: record.extras });
  return n;
}
