// Read side for the trace UI.
import { supabase } from "./client.js";

export async function listRuns(limit = 50) {
  const { data, error } = await supabase
    .from("parser_runs")
    .select("id, customer_id, status, email_type, portal, confidence, error, started_at, finished_at, reviewed_by, reviewed_at, parser_emails(from_email, subject, received_at)")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`parser_runs list: ${error.message}`);
  return (data ?? []).map((r) => {
    const { parser_emails, ...run } = r as typeof r & { parser_emails: Record<string, unknown> | null };
    return { ...run, email: parser_emails };
  });
}

export async function getRun(id: string) {
  const [run, steps, record] = await Promise.all([
    supabase
      .from("parser_runs")
      .select("*, parser_emails(*)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("parser_run_steps").select("*").eq("run_id", id).order("position"),
    supabase.from("parser_records").select("*").eq("run_id", id).maybeSingle(),
  ]);
  if (run.error) throw new Error(`parser_runs get: ${run.error.message}`);
  if (!run.data) return null;
  if (steps.error) throw new Error(`parser_run_steps get: ${steps.error.message}`);
  if (record.error) throw new Error(`parser_records get: ${record.error.message}`);
  const { parser_emails, ...rest } = run.data as Record<string, unknown> & { parser_emails: unknown };
  return { ...rest, email: parser_emails, steps: steps.data ?? [], record: record.data ?? null };
}

// A person's decision. Allowed from ready or needs_review only; anything else
// (running, skipped, failed, already reviewed) is refused so the audit trail
// stays honest.
export async function reviewRun(id: string, decision: "approved" | "rejected", reviewer: string, note: string | null) {
  const { data: run, error: lookupErr } = await supabase.from("parser_runs").select("status").eq("id", id).maybeSingle();
  if (lookupErr) throw new Error(`parser_runs get: ${lookupErr.message}`);
  if (!run) return { ok: false as const, reason: "not found" };
  if (run.status !== "ready" && run.status !== "needs_review") return { ok: false as const, reason: `cannot review a run in status ${run.status}` };
  const { error } = await supabase
    .from("parser_runs")
    .update({ status: decision, reviewed_by: reviewer, reviewed_at: new Date().toISOString(), review_note: note })
    .eq("id", id);
  if (error) throw new Error(`parser_runs review: ${error.message}`);
  return { ok: true as const };
}
