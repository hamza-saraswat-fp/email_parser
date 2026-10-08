export type RunStatus = "running" | "ready" | "needs_review" | "skipped" | "failed";

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
  record: { record: unknown; required_missing: string[] } | null;
}

import { authHeaders } from "./auth";

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  runs: (limit = 50) => get<RunListItem[]>(`/api/runs?limit=${limit}`),
  run: (id: string) => get<RunDetail>(`/api/runs/${id}`),
};
