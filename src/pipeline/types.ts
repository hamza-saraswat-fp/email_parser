import type { EmailType, Portal, ServiceRequest } from "../schema/record.js";

export interface InboundAttachment {
  attachment_id: string | null;
  filename: string | null;
  size: number | null;
  content_type: string | null;
}

// One inbound email, the same shape whether it came from the AgentMail
// WebSocket, the REST catch-up, or a .eml fixture.
export interface InboundEmail {
  message_id: string;
  inbox_id: string;
  from_email: string | null;
  from_name: string | null;
  to: string[];
  subject: string | null;
  text: string | null;
  html: string | null;
  attachments: InboundAttachment[];
  received_at: string; // ISO
}

export interface Customer {
  id: string;
  name: string;
  inbox_id: string;
  required_fields: string[];
}

export type StepStatus = "ok" | "skipped" | "failed";

export interface StepRow {
  position: number;
  name: string;
  status: StepStatus;
  input: unknown;
  output: unknown;
  error: string | null;
  duration_ms: number;
}

export type RunStatus = "running" | "ready" | "needs_review" | "skipped" | "failed" | "approved" | "rejected";

// Everything that can send a run to a person, kept apart so the reviewer sees
// each kind on its own.
export interface CheckResults {
  sort: string[];      // e.g. ["sort_uncertain"]
  verify: string[];    // e.g. ["site.address.line1: not in email"]
  semantic: string[];  // e.g. ["address_is_the_site: 0.41"]
  required: string[];  // e.g. ["work.description"]
}

export interface RunPatch {
  status: RunStatus;
  email_type?: EmailType | null;
  portal?: Portal | null;
  confidence?: number | null;
  error?: string | null;
}

// Where runs are written. Supabase in the service; memory for replay.
export interface RunStore {
  storeEmail(email: InboundEmail, customerId: string | null): Promise<{ id: string; duplicate: boolean }>;
  createRun(emailId: string, customerId: string): Promise<string>;
  addStep(runId: string, step: StepRow): Promise<void>;
  finishRun(runId: string, patch: RunPatch): Promise<void>;
  storeRecord(runId: string, customerId: string, record: ServiceRequest, checks: CheckResults): Promise<void>;
}

export interface RunSummary {
  run_id: string;
  status: RunStatus;
  email_type: EmailType | null;
  portal: Portal | null;
  checks: CheckResults;
  record: ServiceRequest | null;
  error: string | null;
}

export const emptyChecks = (): CheckResults => ({ sort: [], verify: [], semantic: [], required: [] });
export const checksFailed = (c: CheckResults): string[] => [
  ...c.sort, ...c.verify.map((x) => `verify: ${x}`), ...c.semantic.map((x) => `semantic: ${x}`), ...c.required.map((x) => `required: ${x}`),
];
