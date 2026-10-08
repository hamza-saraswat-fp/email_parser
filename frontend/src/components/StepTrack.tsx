import { PIPELINE_STEPS, STEP_LABELS, fmtMs } from "@/lib/steps";

export interface StepSummary { name: string; status: string; duration_ms: number | null }

const DOT: Record<string, string> = {
  ok: "bg-emerald-500",
  failed: "bg-red-500",
  skipped: "bg-slate-300",
  missing: "bg-slate-200 border border-dashed border-slate-400",
};

// Seven dots, one per pipeline step, in order. Hover for the step name and time.
export function StepTrack({ steps, status }: { steps: StepSummary[]; status: string }) {
  const byName = new Map(steps.map((s) => [s.name, s]));
  const total = steps.reduce((n, s) => n + (s.duration_ms ?? 0), 0);
  return (
    <div className="flex items-center gap-1" title={`${steps.length} of ${PIPELINE_STEPS.length} steps · ${fmtMs(total)} total`}>
      {PIPELINE_STEPS.map((name) => {
        const s = byName.get(name);
        const cls = s ? DOT[s.status] ?? DOT.ok : status === "running" ? DOT.missing : DOT.missing;
        return <span key={name} className={`inline-block h-2.5 w-2.5 rounded-full ${cls}`} title={`${STEP_LABELS[name]}: ${s ? `${s.status}, ${fmtMs(s.duration_ms)}` : "not run"}`} />;
      })}
      <span className="ml-1 text-xs tabular-nums text-slate-400">{fmtMs(total)}</span>
    </div>
  );
}
