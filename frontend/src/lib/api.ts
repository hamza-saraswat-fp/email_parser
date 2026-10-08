export type RunStatus = "running" | "ready" | "needs_review" | "skipped" | "failed" | "approved" | "rejected";

export interface CheckResults { sort: string[]; verify: string[]; semantic: string[]; required: string[] }

export interface RunListItem {
  id: string;
  customer_id: string;
  status: RunStatus;
  email_type: string | null;
  portal: string | null;
  confidence: number | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  email: { from_email: string | null; subject: string | null; received_at: string } | null;
}

export interface RunStep {
  id: string;
  position: number;
  name: string;
  status: "ok" | "skipped" | "failed";
  input: unknown;
  output: unknown;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface RunDetail extends Omit<RunListItem, "email"> {
  email: {
    from_email: string | null;
    from_name: string | null;
    subject: string | null;
    text: string | null;
    html: string | null;
    attachments: unknown[];
    received_at: string;
    inbox_id: string;
  } | null;
  steps: RunStep[];
  record: { record: unknown; required_missing: CheckResults | string[] } | null;
  review_note?: string | null;
}

import { authHeaders } from "./auth";

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `${url}: ${res.status}`);
  return json as T;
}

export const api = {
  runs: (limit = 50) => get<RunListItem[]>(`/api/runs?limit=${limit}`),
  run: (id: string) => get<RunDetail>(`/api/runs/${id}`),
  approve: (id: string, note: string) => post<{ ok: true }>(`/api/runs/${id}/approve`, { note }),
  reject: (id: string, note: string) => post<{ ok: true }>(`/api/runs/${id}/reject`, { note }),
};

// Checks failed, flattened for display. Older rows stored a plain string list.
export function failedChecks(c: CheckResults | string[] | undefined | null): string[] {
  if (!c) return [];
  if (Array.isArray(c)) return c;
  return [...c.sort, ...c.verify.map((x) => `verify: ${x}`), ...c.semantic.map((x) => `semantic: ${x}`), ...c.required.map((x) => `required: ${x}`)];
}
