import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type RunListItem, type RunStatus } from "@/lib/api";
import { navigate } from "@/lib/router";
import { StatusBadge } from "@/components/StatusBadge";
import { StepTrack } from "@/components/StepTrack";
import { failedChecks } from "@/lib/api";

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleString();
}

const STATUS_ORDER: RunStatus[] = ["running", "ready", "needs_review", "delivered", "delivery_failed", "approved", "rejected", "skipped", "failed"];

export function RunsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["runs"],
    queryFn: () => api.runs(100),
    refetchInterval: 2_000,
  });

  const [filter, setFilter] = useState<RunStatus | null>(null);
  const counts = STATUS_ORDER.map((s) => [s, (data ?? []).filter((r) => r.status === s).length] as const);
  const rows = (data ?? []).filter((r) => !filter || r.status === filter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-semibold">Runs</h1>
        {counts.map(([s, n]) => (
          <button
            key={s}
            onClick={() => setFilter(filter === s ? null : s)}
            className={`flex items-center gap-1 rounded px-1 text-xs text-slate-600 ${filter === s ? "ring-2 ring-slate-400" : ""}`}
            title={filter === s ? "Show all" : `Show only ${s}`}
          >
            <StatusBadge status={s} /> {n}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-400">refreshes every 2s</span>
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{String(error)}</div>}
      {isLoading && <div className="text-sm text-slate-500">Loading…</div>}

      {data && data.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          No runs yet. Forward a portal email to the inbox, or run <code>npm run replay -- file.eml --db</code>.
        </div>
      )}

      {data && data.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Subject</th>
                <th className="px-3 py-2">Portal · type</th>
                <th className="px-3 py-2">Steps</th>
                <th className="px-3 py-2">Checks</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: RunListItem) => (
                <tr
                  key={r.id}
                  onClick={() => navigate(`/runs/${r.id}`)}
                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                >
                  <td className="whitespace-nowrap px-3 py-2 text-slate-500">{timeAgo(r.started_at)}</td>
                  <td className="px-3 py-2">{r.customer_id}</td>
                  <td className="max-w-[22rem] px-3 py-2">
                    <div className="truncate">{r.email?.subject ?? "(no subject)"}</div>
                    <div className="truncate text-xs text-slate-500">{r.email?.from_email ?? "—"}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{r.portal ?? "—"}<div className="text-xs text-slate-500">{r.email_type ?? "—"}</div></td>
                  <td className="px-3 py-2"><StepTrack steps={r.steps ?? []} status={r.status} /></td>
                  <td className="px-3 py-2">{(() => { const f = failedChecks(r.checks); return f.length ? <span className="text-amber-700" title={f.join("\n")}>{f.length} failed</span> : r.steps?.some((s) => s.name === "checked") ? <span className="text-emerald-700">clean</span> : <span className="text-slate-400">—</span>; })()}</td>
                  <td className="px-3 py-2"><StatusBadge status={r.status} />{r.reviewed_by ? <div className="mt-0.5 max-w-[10rem] truncate text-[11px] text-slate-500" title={r.reviewed_by}>{r.reviewed_by}</div> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
