// FieldPulse external API client. One key = one FieldPulse user = one company.
//
// Envelope: every response is { error: boolean, response: ..., updates?: [] }.
// Validation failures come back as 400 or 422, and sometimes as 200 with
// error:true and an `errors` array, so a 200 is not success until `error` is
// checked. The key is never logged.
export interface FieldPulseClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  log?: (line: string) => void;
}

export class FieldPulseError extends Error {
  constructor(
    message: string,
    public status: number,
    public errors: unknown = null,
    public path: string = "",
  ) {
    super(message);
    this.name = "FieldPulseError";
  }
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type Query = Record<string, string | number | boolean | undefined>;

export class FieldPulseClient {
  private baseUrl: string;
  private apiKey: string;
  private fetchFn: typeof fetch;
  private timeoutMs: number;
  private log: (line: string) => void;

  constructor(opts: FieldPulseClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.log = opts.log ?? ((line) => console.log(line));
  }

  get<T = unknown>(path: string, query: Query = {}): Promise<T> {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    return this.request<T>("GET", qs ? `${path}?${qs}` : path);
  }

  post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    let lastErr: Error = new Error("no attempts made");
    for (let attempt = 1; attempt <= 3; attempt++) {
      const t0 = Date.now();
      let res: Response | null = null;
      try {
        res = await this.fetchFn(url, {
          method,
          headers: { "X-API-KEY": this.apiKey, "Content-Type": "application/json", Accept: "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (e) {
        lastErr = e as Error;
        this.log(`[FP] ${method} ${path} network error (${Date.now() - t0}ms): ${lastErr.message}`);
      }
      if (res) {
        const text = await res.text();
        let json: any = null;
        try { json = text ? JSON.parse(text) : null; } catch { json = null; }
        this.log(`[FP] ${method} ${path} -> ${res.status} (${Date.now() - t0}ms)`);
        if (res.ok) {
          if (json && typeof json === "object" && json.error === true) {
            throw new FieldPulseError(describe(json), res.status, json.errors ?? json.response ?? null, path);
          }
          return (json && typeof json === "object" && "response" in json ? json.response : json) as T;
        }
        if (!RETRY_STATUS.has(res.status)) {
          throw new FieldPulseError(json ? describe(json) : `HTTP ${res.status} ${text.slice(0, 200)}`, res.status, json?.errors ?? json?.response ?? null, path);
        }
        lastErr = new FieldPulseError(json ? describe(json) : `HTTP ${res.status}`, res.status, json?.errors ?? null, path);
      }
      if (attempt < 3) await wait(500 * attempt);
    }
    throw lastErr;
  }
}

function describe(json: any): string {
  if (typeof json?.message === "string") return json.message;
  const errs = json?.errors;
  if (Array.isArray(errs)) return errs.map(String).join("; ");
  if (errs && typeof errs === "object") return Object.entries(errs).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`).join("; ");
  if (typeof json?.error === "string") return json.error;
  return "FieldPulse request failed";
}
