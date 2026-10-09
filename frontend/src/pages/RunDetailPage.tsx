import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ArrowLeft } from "lucide-react";
import { api, failedChecks, type RunStep } from "@/lib/api";
import { navigate } from "@/lib/router";
import { StatusBadge } from "@/components/StatusBadge";
import { JsonBlock } from "@/components/JsonBlock";
import { PIPELINE_STEPS, STEP_LABELS as LABELS, STEP_KIND, notRunReason, fmtMs } from "@/lib/steps";

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

function tokens(out: Record<string, unknown> | null): string | null {
  const u = out?.usage as { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number } | null | undefined;
  if (!u) return null;
  const i = u.input_tokens ?? u.prompt_tokens;
  const o = u.output_tokens ?? u.completion_tokens;
  return i == null && o == null ? null : `${i ?? "?"} in / ${o ?? "?"} out tokens`;
}

function Step({ step, maxMs }: { step: RunStep; maxMs: number }) {
  const [open, setOpen] = useState(step.status === "failed");
  const out = step.output as Record<string, unknown> | null;
  const tok = tokens(out);
  const kind = STEP_KIND[step.name] ?? "code";
  const verifyFailures = step.name === "verified" && Array.isArray(out?.failures) ? (out!.failures as Array<{ field: string; rule: string; value: string }>) : [];
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
        <span className="whitespace-nowrap font-medium">{LABELS[step.name] ?? step.name}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${kind === "model" ? "bg-violet-100 text-violet-800" : "bg-sky-100 text-sky-800"}`}>{kind}</span>
        <span className="min-w-0 truncate text-sm text-slate-500">{summary}</span>
        <span className="ml-auto flex items-center gap-2 whitespace-nowrap text-xs text-slate-400">
          {tok && <span className="hidden sm:inline">{tok}</span>}
          <span className="hidden h-1.5 w-24 rounded bg-slate-100 sm:inline-block"><span className="block h-1.5 rounded bg-slate-400" style={{ width: `${Math.max(2, Math.round(((step.duration_ms ?? 0) / Math.max(1, maxMs)) * 100))}%` }} /></span>
          <span className="w-12 text-right tabular-nums">{fmtMs(step.duration_ms)}</span>
        </span>
        <StatusBadge status={step.status} />
      </button>
      {open && verifyFailures.length > 0 && (
        <div className="border-t border-slate-100 p-3">
          <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Values not supported by the email</div>
          <table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th className="py-1 pr-3">Field</th><th className="py-1 pr-3">Rule</th><th className="py-1">Value</th></tr></thead>
            <tbody>{verifyFailures.map((f, i) => <tr key={i} className="border-t border-slate-100"><td className="py-1 pr-3 font-mono text-xs">{f.field}</td><td className="py-1 pr-3">{f.rule}</td><td className="py-1 font-mono text-xs">{f.value}</td></tr>)}</tbody></table>
        </div>
      )}
      {open && step.name === "cleaned" && typeof out?.body === "string" && (
        <div className="border-t border-slate-100 p-3">
          <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Text the models read ({(out.body as string).length} chars)</div>
          <JsonBlock value={out.body} maxHeight="24rem" />
        </div>
      )}
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
    mutationFn: ({ decision }: { decision: "approve" | "reject" | "deliver" }) =>
      decision === "approve" ? api.approve(id, note) : decision === "reject" ? api.reject(id, note) : api.deliver(id),
    onSettled: () => { qc.invalidateQueries({ queryKey: ["run", id] }); qc.invalidateQueries({ queryKey: ["runs"] }); },
  });

  if (isLoading) return <div className="text-sm text-slate-500">Loading…</div>;
  if (error || !data) return <div className="text-sm text-red-700">{String(error ?? "not found")}</div>;
  const failed = failedChecks(data.record?.required_missing);
  const reviewable = data.status === "ready" || data.status === "needs_review";
  const retryable = data.status === "delivery_failed";

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
              {review.isPending ? "Creating job…" : "Approve & create job"}
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
        {(data.delivery || retryable) && (
          <div className={`mt-4 rounded border p-3 text-sm ${data.delivery?.status === "delivered" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">FieldPulse</div>
            {data.delivery?.status === "delivered" ? (
              <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                <div><span className="text-slate-500">Job</span> #{data.delivery.fp_job_cuid ?? data.delivery.fp_job_id} <span className="text-xs text-slate-400">(id {data.delivery.fp_job_id})</span></div>
                <div><span className="text-slate-500">Created</span> {new Date(data.delivery.created_at).toLocaleString()}</div>
                <div><span className="text-slate-500">Customer</span> #{data.delivery.fp_customer_id}{data.delivery.created_customer ? " (new)" : " (existing)"}</div>
                <div><span className="text-slate-500">Location</span> {data.delivery.fp_location_id ? `#${data.delivery.fp_location_id}${data.delivery.created_location ? " (new)" : " (existing)"}` : "—"}</div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-red-800">{data.delivery?.error ?? data.error ?? "delivery failed"}</span>
                {retryable && (
                  <button onClick={() => review.mutate({ decision: "deliver" })} disabled={review.isPending} className="rounded border border-slate-300 bg-white px-3 py-1 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
                    {review.isPending ? "Retrying…" : "Retry delivery"}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <section>
        <h2 className="mb-2 flex items-baseline gap-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Steps
          <span className="text-xs font-normal normal-case tracking-normal text-slate-400">
            {data.steps.length} of {PIPELINE_STEPS.length} ran · {fmtMs(data.steps.reduce((n, s) => n + (s.duration_ms ?? 0), 0))} total
          </span>
        </h2>
        <ol className="space-y-2">
          {(() => {
            const maxMs = Math.max(1, ...data.steps.map((s) => s.duration_ms ?? 0));
            const byName = new Map(data.steps.map((s) => [s.name, s]));
            const lastStep = data.steps.at(-1)?.name;
            const known = PIPELINE_STEPS.map((name) => byName.get(name) ?? null);
            const extra = data.steps.filter((s) => !(PIPELINE_STEPS as readonly string[]).includes(s.name));
            return [
              ...known.map((s, i) => s
                ? <Step key={s.id} step={s} maxMs={maxMs} />
                : <li key={PIPELINE_STEPS[i]} className="flex items-center gap-3 rounded-lg border border-dashed border-slate-200 px-3 py-2 text-slate-400">
                    <span className="w-4" /><span className="w-6 text-xs">{i + 1}</span>
                    <span className="font-medium">{LABELS[PIPELINE_STEPS[i]]}</span>
                    <span className="text-sm">{notRunReason(data.status, lastStep)}</span>
                  </li>),
              ...extra.map((s) => <Step key={s.id} step={s} maxMs={maxMs} />),
            ];
          })()}
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
