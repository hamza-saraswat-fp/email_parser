// In-memory RunStore for the replay script and tests. Nothing persists.
import { randomUUID } from "node:crypto";
import type { ServiceRequest } from "../schema/record.js";
import type { CheckResults, InboundEmail, RunPatch, RunStore, StepRow } from "./types.js";

export interface MemoryRun {
  id: string;
  email_id: string;
  customer_id: string;
  patch: RunPatch | null;
  steps: StepRow[];
  record: ServiceRequest | null;
  checks: CheckResults | null;
}

export class MemoryStore implements RunStore {
  emails = new Map<string, { id: string; email: InboundEmail; customer_id: string | null }>();
  runs = new Map<string, MemoryRun>();

  async storeEmail(email: InboundEmail, customerId: string | null) {
    const existing = this.emails.get(email.message_id);
    if (existing) return { id: existing.id, duplicate: true };
    const id = randomUUID();
    this.emails.set(email.message_id, { id, email, customer_id: customerId });
    return { id, duplicate: false };
  }
  async createRun(emailId: string, customerId: string) {
    const id = randomUUID();
    this.runs.set(id, { id, email_id: emailId, customer_id: customerId, patch: null, steps: [], record: null, checks: null });
    return id;
  }
  async addStep(runId: string, step: StepRow) {
    this.runs.get(runId)!.steps.push(step);
  }
  async finishRun(runId: string, patch: RunPatch) {
    this.runs.get(runId)!.patch = patch;
  }
  async storeRecord(runId: string, _customerId: string, record: ServiceRequest, checks: CheckResults) {
    const run = this.runs.get(runId)!;
    run.record = record;
    run.checks = checks;
  }
}
