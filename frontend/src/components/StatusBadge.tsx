const STYLES: Record<string, string> = {
  running: "bg-blue-100 text-blue-800",
  ready: "bg-green-100 text-green-800",
  needs_review: "bg-amber-100 text-amber-800",
  skipped: "bg-slate-200 text-slate-700",
  failed: "bg-red-100 text-red-800",
  approved: "bg-emerald-200 text-emerald-900",
  delivering: "bg-blue-100 text-blue-800",
  delivered: "bg-emerald-600 text-white",
  delivery_failed: "bg-red-200 text-red-900",
  rejected: "bg-rose-200 text-rose-900",
  ok: "bg-green-100 text-green-800",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STYLES[status] ?? "bg-slate-100 text-slate-700"}`}>
      {status.replace("_", " ")}
    </span>
  );
}
