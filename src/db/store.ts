// Supabase-backed RunStore. Writes are the record of what happened, so they are
// awaited and errors propagate (a run without steps is worse than a loud failure).
import { supabase } from "./client.js";
import type { ServiceRequest } from "../schema/record.js";
import type { InboundEmail, RunPatch, RunStore, StepRow } from "../pipeline/types.js";

export class SupabaseStore implements RunStore {
  async storeEmail(email: InboundEmail, customerId: string | null) {
    const { data: existing, error: lookupErr } = await supabase
      .from("parser_emails")
      .select("id")
      .eq("message_id", email.message_id)
      .maybeSingle();
    if (lookupErr) throw new Error(`parser_emails lookup: ${lookupErr.message}`);
    if (existing) return { id: existing.id as string, duplicate: true };

    const { data, error } = await supabase
      .from("parser_emails")
      .insert({
        message_id: email.message_id,
        inbox_id: email.inbox_id,
        customer_id: customerId,
        from_email: email.from_email,
        from_name: email.from_name,
        to_emails: email.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
        attachments: email.attachments,
        received_at: email.received_at,
      })
      .select("id")
      .single();
    if (error) {
      // A concurrent insert of the same message_id (WebSocket + catch-up) hits the
      // unique constraint; treat it as the duplicate it is.
      if (error.code === "23505") return { id: "", duplicate: true };
      throw new Error(`parser_emails insert: ${error.message}`);
    }
    return { id: data.id as string, duplicate: false };
  }

  async createRun(emailId: string, customerId: string) {
    const { data, error } = await supabase
      .from("parser_runs")
      .insert({ email_id: emailId, customer_id: customerId, status: "running" })
      .select("id")
      .single();
    if (error) throw new Error(`parser_runs insert: ${error.message}`);
    return data.id as string;
  }

  async addStep(runId: string, step: StepRow) {
    const { error } = await supabase.from("parser_run_steps").insert({ run_id: runId, ...step });
    if (error) throw new Error(`parser_run_steps insert: ${error.message}`);
  }

  async finishRun(runId: string, patch: RunPatch) {
    const { error } = await supabase
      .from("parser_runs")
      .update({ ...patch, finished_at: new Date().toISOString() })
      .eq("id", runId);
    if (error) throw new Error(`parser_runs update: ${error.message}`);
  }

  async storeRecord(runId: string, customerId: string, record: ServiceRequest, requiredMissing: string[]) {
    const { error } = await supabase
      .from("parser_records")
      .insert({ run_id: runId, customer_id: customerId, record, required_missing: requiredMissing });
    if (error) throw new Error(`parser_records insert: ${error.message}`);
  }
}
