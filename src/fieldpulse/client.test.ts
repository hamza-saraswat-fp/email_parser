import { describe, it, expect } from "vitest";
import { FieldPulseClient, FieldPulseError } from "./client.js";

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { status: 500, body: { message: "exhausted" } };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const make = (f: typeof fetch) => new FieldPulseClient({ baseUrl: "https://api.test/v2.5/", apiKey: "k", fetchFn: f, log: () => {} });

describe("FieldPulseClient", () => {
  it("sends the key header and unwraps the envelope", async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { error: false, response: { id: 7 } } }]);
    const out = await make(fn).get<{ id: number }>("/customer", { search: "TOPS MARKETS", limit: 10 });
    expect(out).toEqual({ id: 7 });
    expect(calls[0].url).toBe("https://api.test/v2.5/customer?search=TOPS%20MARKETS&limit=10");
    expect((calls[0].init.headers as Record<string, string>)["X-API-KEY"]).toBe("k");
  });
  it("treats 200 with error:true as a failure with the errors array", async () => {
    const { fn } = fakeFetch([{ status: 200, body: { error: true, response: null, errors: ["The job type field is required."] } }]);
    await expect(make(fn).post("/job", {})).rejects.toMatchObject({ name: "FieldPulseError", status: 200, message: "The job type field is required." });
  });
  it("surfaces 422 object errors and does not retry 4xx", async () => {
    const { fn, calls } = fakeFetch([{ status: 422, body: { errors: { customer_id: ["required"] } } }]);
    await expect(make(fn).post("/job", {})).rejects.toMatchObject({ status: 422, message: "customer_id: required" });
    expect(calls.length).toBe(1);
  });
  it("retries a 503 then succeeds", async () => {
    const { fn, calls } = fakeFetch([{ status: 503, body: { message: "busy" } }, { status: 201, body: { error: false, response: { id: 1 } } }]);
    expect(await make(fn).post("/job", { a: 1 })).toEqual({ id: 1 });
    expect(calls.length).toBe(2);
  });
  it("gives up after three retryable failures", async () => {
    const { fn, calls } = fakeFetch([{ status: 500, body: {} }, { status: 500, body: {} }, { status: 500, body: {} }]);
    await expect(make(fn).get("/users")).rejects.toBeInstanceOf(FieldPulseError);
    expect(calls.length).toBe(3);
  });
});
