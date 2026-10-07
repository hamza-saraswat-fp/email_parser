// Read side for the trace UI.
import { supabase } from "./client.js";

export async function listRuns(limit = 50) {
  const { data, error } = await supabase
    .from("parser_runs")
    .select("id, customer_id, status, email_type, portal, confidence, error, started_at, finished_at, parser_emails(from_email, subject, received_at)")
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
