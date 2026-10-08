import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type RunListItem, type RunStatus } from "@/lib/api";
import { navigate } from "@/lib/router";
import { StatusBadge } from "@/components/StatusBadge";

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleString();
}

const STATUS_ORDER: RunStatus[] = ["running", "ready", "needs_review", "approved", "rejected", "skipped", "failed"];

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
                <th className="px-3 py-2">From</th>
                <th className="px-3 py-2">Subject</th>
                <th className="px-3 py-2">Portal</th>
                <th className="px-3 py-2">Type</th>
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
                  <td className="max-w-[16rem] truncate px-3 py-2 text-slate-600">{r.email?.from_email ?? "—"}</td>
                  <td className="max-w-[24rem] truncate px-3 py-2">{r.email?.subject ?? "(no subject)"}</td>
                  <td className="px-3 py-2">{r.portal ?? "—"}</td>
                  <td className="px-3 py-2">{r.email_type ?? "—"}</td>
                  <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
