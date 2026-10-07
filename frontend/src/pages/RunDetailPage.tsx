import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ArrowLeft } from "lucide-react";
import { api, type RunStep } from "@/lib/api";
import { navigate } from "@/lib/router";
import { StatusBadge } from "@/components/StatusBadge";
import { JsonBlock } from "@/components/JsonBlock";

const STEP_LABELS: Record<string, string> = {
  received: "Received",
  cleaned: "Cleaned to plain text",
  classified: "Classified",
  extracted: "Extracted",
  checked: "Checked required fields",
};

function Step({ step }: { step: RunStep }) {
  const [open, setOpen] = useState(step.status === "failed");
  const out = step.output as Record<string, unknown> | null;
  const summary =
    step.name === "cleaned" && out ? `${out.chars} chars from ${out.source}` :
    step.name === "classified" && out ? `${out.email_type} · ${out.portal} · ${Math.round(Number(out.confidence) * 100)}%` :
    step.name === "checked" && out ? (Array.isArray(out.required_missing) && out.required_missing.length ? `missing: ${(out.required_missing as string[]).join(", ")}` : "all required fields present") :
    step.name === "extracted" && out ? `model ${out.model}` :
    step.name === "received" && out ? `${(out.attachments as unknown[])?.length ?? 0} attachment(s)` :
    "";
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

  if (isLoading) return <div className="text-sm text-slate-500">Loading…</div>;
  if (error || !data) return <div className="text-sm text-red-700">{String(error ?? "not found")}</div>;

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
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Record {data.record.required_missing.length ? <span className="ml-2 normal-case text-amber-700">missing: {data.record.required_missing.join(", ")}</span> : null}
          </h2>
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
