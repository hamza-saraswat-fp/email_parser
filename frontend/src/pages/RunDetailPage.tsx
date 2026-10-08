import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ArrowLeft } from "lucide-react";
import { api, failedChecks, type RunStep } from "@/lib/api";
import { navigate } from "@/lib/router";
import { StatusBadge } from "@/components/StatusBadge";
import { JsonBlock } from "@/components/JsonBlock";

const STEP_LABELS: Record<string, string> = {
  received: "Received",
  cleaned: "Cleaned to plain text",
  classified: "Classified",
  sorted: "Sorted (Jev)",
  extracted: "Read (Sonnet)",
  verified: "Verified against the email",
  semantic: "Semantic checks (Jev)",
  checked: "Required fields",
};

function pct(n: unknown) { return typeof n === "number" ? `${Math.round(n * 100)}%` : "—"; }

function Bars({ values }: { values: Record<string, number> }) {
  const entries = Object.entries(values).sort((a, b) => b[1] - a[1]);
  return (
    <div className="grid gap-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-2 text-xs">
          <span className="w-44 truncate text-slate-600">{k}</span>
          <span className="h-2 flex-1 rounded bg-slate-100"><span className="block h-2 rounded bg-slate-500" style={{ width: `${Math.round(v * 100)}%` }} /></span>
          <span className="w-10 text-right tabular-nums text-slate-500">{pct(v)}</span>
        </div>
      ))}
    </div>
  );
}

function Step({ step }: { step: RunStep }) {
  const [open, setOpen] = useState(step.status === "failed");
  const out = step.output as Record<string, unknown> | null;
  const decision = out?.decision as { outcome?: string; reason?: string } | undefined;
  const summary =
    step.name === "cleaned" && out ? `${out.chars} chars from ${out.source}${out.trimmed_forward_wrapper ? ", forward wrapper trimmed" : ""}` :
    step.name === "classified" && out ? `${out.email_type} · ${out.portal} · ${pct(out.confidence)}` :
    step.name === "sorted" && out ? `${out.email_type} ${pct(out.email_type_confidence)} · ${out.portal} ${pct(out.portal_confidence)} · dispatches new work ${pct(out.dispatches_new_work)} → ${decision?.outcome ?? ""}` :
    step.name === "verified" && out ? (Array.isArray(out.failures) && out.failures.length ? `${(out.failures as unknown[]).length} value(s) not supported by the email` : `all ${out.values_checked} values found in the email`) :
    step.name === "semantic" && out ? (Array.isArray(out.failures) && out.failures.length ? `${(out.failures as unknown[]).length} check(s) below threshold` : "all checks passed") :
    step.name === "checked" && out ? (Array.isArray(out.required_missing) && out.required_missing.length ? `missing: ${(out.required_missing as string[]).join(", ")}` : "all required fields present") :
    step.name === "extracted" && out ? `model ${out.model}` :
    step.name === "received" && out ? `${(out.attachments as unknown[])?.length ?? 0} attachment(s)` :
    "";
  const bars =
    step.name === "sorted" && out ? { "Email type": out.email_type_probabilities as Record<string, number>, "Portal": out.portal_probabilities as Record<string, number> } :
    step.name === "semantic" && out && out.scores ? { "Checks": Object.fromEntries(Object.entries(out.scores as Record<string, number | null>).filter(([, v]) => typeof v === "number")) as Record<string, number> } :
    null;
  return (
    <li className="rounded-lg border border-slate-200 bg-white">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-3 py-2 text-left">
        {open ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
        <span className="w-6 text-xs text-slate-400">{step.position}</span>
        <span className="font-medium">{STEP_LABELS[step.name] ?? step.name}</span>
        <span className="truncate text-sm text-slate-500">{summary}</span>
        <span className="ml-auto whitespace-nowrap text-xs text-slate-400">{step.duration_ms ?? 0} ms</span>
        <StatusBadge status={step.status} />
      </button>
      {open && bars && (
        <div className="grid gap-4 border-t border-slate-100 p-3 md:grid-cols-2">
          {Object.entries(bars).map(([title, values]) => (
            <div key={title}>
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">{title}</div>
              <Bars values={values} />
            </div>
          ))}
        </div>
      )}
      {open && (
        <div className="grid gap-3 border-t border-slate-100 p-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Input</div>
            <JsonBlock value={step.input} />
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase text-slate-500">{step.error ? "Error" : "Output"}</div>
            <JsonBlock value={step.error ?? step.output} />
          </div>
        </div>
      )}
    </li>
  );
}

export function RunDetailPage({ id }: { id: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["run", id],
    queryFn: () => api.run(id),
    refetchInterval: (q) => (q.state.data?.status === "running" ? 1_000 : false),
  });
  const [showEmail, setShowEmail] = useState(false);
  const [note, setNote] = useState("");
  const qc = useQueryClient();
  const review = useMutation({
    mutationFn: ({ decision }: { decision: "approve" | "reject" }) => (decision === "approve" ? api.approve(id, note) : api.reject(id, note)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["run", id] }); qc.invalidateQueries({ queryKey: ["runs"] }); },
  });

  if (isLoading) return <div className="text-sm text-slate-500">Loading…</div>;
  if (error || !data) return <div className="text-sm text-red-700">{String(error ?? "not found")}</div>;
  const failed = failedChecks(data.record?.required_missing);
  const reviewable = data.status === "ready" || data.status === "needs_review";

  return (
    <div className="space-y-5">
      <button onClick={() => navigate("/")} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft size={14} /> All runs
      </button>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={data.status} />
          <h1 className="text-lg font-semibold">{data.email?.subject ?? "(no subject)"}</h1>
        </div>
        <div className="mt-2 grid gap-x-6 gap-y-1 text-sm text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
          <div><span className="text-slate-400">From</span> {data.email?.from_email ?? "—"}</div>
          <div><span className="text-slate-400">Inbox</span> {data.email?.inbox_id ?? "—"}</div>
          <div><span className="text-slate-400">Customer</span> {data.customer_id}</div>
          <div><span className="text-slate-400">Received</span> {data.email ? new Date(data.email.received_at).toLocaleString() : "—"}</div>
          <div><span className="text-slate-400">Portal</span> {data.portal ?? "—"}</div>
          <div><span className="text-slate-400">Type</span> {data.email_type ?? "—"}</div>
          <div><span className="text-slate-400">Confidence</span> {data.confidence != null ? `${Math.round(data.confidence * 100)}%` : "—"}</div>
          <div><span className="text-slate-400">Run</span> <code className="text-xs">{data.id.slice(0, 8)}</code></div>
        </div>
        {data.error && <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{data.error}</div>}
        {failed.length > 0 && (
          <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
            <div className="font-medium">Held for a person</div>
            <ul className="mt-1 list-disc pl-5">{failed.map((f) => <li key={f}>{f}</li>)}</ul>
          </div>
        )}
        {data.reviewed_by && (
          <div className="mt-3 text-sm text-slate-600">
            {data.status === "approved" ? "Approved" : "Rejected"} by {data.reviewed_by}{data.reviewed_at ? ` on ${new Date(data.reviewed_at).toLocaleString()}` : ""}{data.review_note ? ` · "${data.review_note}"` : ""}
          </div>
        )}
        {reviewable && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <input
              id="review-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional)"
              className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
            />
            <button
              onClick={() => review.mutate({ decision: "approve" })}
              disabled={review.isPending}
              className="rounded bg-emerald-700 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              onClick={() => review.mutate({ decision: "reject" })}
              disabled={review.isPending}
              className="rounded border border-rose-300 px-3 py-1 text-sm font-medium text-rose-800 hover:bg-rose-50 disabled:opacity-50"
            >
              Reject
            </button>
            {review.error && <span className="text-sm text-red-700">{String((review.error as Error).message)}</span>}
          </div>
        )}
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Steps</h2>
        <ol className="space-y-2">
          {data.steps.map((s) => <Step key={s.id} step={s} />)}
          {data.status === "running" && <li className="text-sm text-slate-400">working…</li>}
        </ol>
      </section>

      {data.record && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Record</h2>
          <JsonBlock value={data.record.record} maxHeight="40rem" />
        </section>
      )}

      <section>
        <button onClick={() => setShowEmail(!showEmail)} className="text-sm text-slate-500 hover:text-slate-800">
          {showEmail ? "Hide" : "Show"} original email
        </button>
        {showEmail && data.email && (
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Text</div>
              <JsonBlock value={data.email.text ?? "(none)"} maxHeight="30rem" />
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">HTML (rendered)</div>
              <iframe
                title="email html"
                sandbox=""
                srcDoc={data.email.html ?? "<p>(none)</p>"}
                className="h-[30rem] w-full rounded border border-slate-200 bg-white"
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
