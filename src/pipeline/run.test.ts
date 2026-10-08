import { describe, it, expect } from "vitest";
import { processInbound } from "./run.js";
import { MemoryStore } from "./memory-store.js";
import { DEFAULT_REQUIRED_FIELDS } from "../schema/record.js";
import type { ChatJsonFn } from "../llm/openrouter.js";
import type { AskJevFn } from "../llm/jev.js";
import type { Customer, InboundEmail } from "./types.js";

const customer: Customer = { id: "dev", name: "dev", inbox_id: "parser_test@agentmail.to", required_fields: DEFAULT_REQUIRED_FIELDS };

const HTML = "<p>New Service Request #1</p><p>Customer <b>TOPS</b></p><p>PO# 1</p><p>Address 1 Main St, Amherst NY 14228</p><p>Problem: light out</p>";

function email(over: Partial<InboundEmail> = {}): InboundEmail {
  return {
    message_id: `<m-${Math.random()}@test>`, inbox_id: customer.inbox_id,
    from_email: "dispatch@servicechannel.com", from_name: "ServiceChannel", to: ["service@example.com"],
    subject: "New Service Request #1", text: null, html: HTML, attachments: [], received_at: "2026-09-09T13:12:00.000Z",
    ...over,
  };
}

const extracted = {
  reference: { primary: "1", all: [{ label: "PO#", value: "1" }] },
  requester: { organization: "TOPS" },
  site: { name: null, identifier: null, address: { line1: "1 Main St", city: "Amherst", state: "NY", postal_code: "14228" }, phone: null },
  work: { description: "light out" },
  priority: { raw: null }, deadlines: {}, limits: { not_to_exceed: null }, extras: {}, notes: null,
};

const fakeChat = (data: unknown = extracted): ChatJsonFn => async () => ({ content: JSON.stringify(data), model: "fake-reader", usage: null });

function fakeJev(opts: { type?: string; conf?: number; dispatch?: number; semantic?: Record<string, number> } = {}): AskJevFn {
  return async (_state, questions) => {
    const ids = Object.keys(questions);
    if (ids.includes("email_type")) {
      return { model: "typesafe-ai/jev", usage: null, answers: {
        email_type: { type: "choice", choice: opts.type ?? "new_request", confidence: opts.conf ?? 0.96, probabilities: {} },
        portal: { type: "choice", choice: "servicechannel", confidence: 0.99, probabilities: {} },
        dispatches_new_work: { type: "boolean", boolean: opts.dispatch ?? 0.94 },
      } };
    }
    return { model: "typesafe-ai/jev", usage: null, answers: Object.fromEntries(ids.map((id) => [id, { type: "boolean" as const, boolean: opts.semantic?.[id] ?? 0.92 }])) };
  };
}

const quiet = { log: () => {} };

describe("processInbound", () => {
  it("runs every step and produces a ready record", async () => {
    const store = new MemoryStore();
    const s = await processInbound(email(), customer, store, { ...quiet, chat: fakeChat(), ask: fakeJev() });
    expect(s?.status).toBe("ready");
    const run = store.runs.get(s!.run_id)!;
    expect(run.steps.map((x) => x.name)).toEqual(["received", "cleaned", "sorted", "extracted", "verified", "semantic", "checked"]);
    expect(run.record?.reference.primary).toBe("1");
    expect(run.checks).toEqual({ sort: [], verify: [], semantic: [], required: [] });
  });

  it("skips a confident non-request after sorting", async () => {
    const store = new MemoryStore();
    const s = await processInbound(email(), customer, store, { ...quiet, chat: fakeChat(), ask: fakeJev({ type: "reminder" }) });
    expect(s?.status).toBe("skipped");
    expect(store.runs.get(s!.run_id)!.steps.map((x) => x.name)).toEqual(["received", "cleaned", "sorted"]);
  });

  it("sends an uncertain sort to a person instead of guessing", async () => {
    const store = new MemoryStore();
    const s = await processInbound(email(), customer, store, { ...quiet, chat: fakeChat(), ask: fakeJev({ conf: 0.5 }) });
    expect(s?.status).toBe("needs_review");
    expect(s?.checks.sort[0]).toContain("sort_uncertain");
    expect(s?.record).toBeNull();
  });

  it("holds a record with an invented address", async () => {
    const store = new MemoryStore();
    const bad = { ...extracted, site: { ...extracted.site, address: { ...extracted.site.address, line1: "99 Fake Street" } } };
    const s = await processInbound(email(), customer, store, { ...quiet, chat: fakeChat(bad), ask: fakeJev() });
    expect(s?.status).toBe("needs_review");
    expect(s?.checks.verify).toEqual(["site.address.line1: not_in_email (99 Fake Street)"]);
    expect(s?.record).not.toBeNull();
  });

  it("holds a record when a semantic check falls below the threshold", async () => {
    const store = new MemoryStore();
    const s = await processInbound(email(), customer, store, { ...quiet, chat: fakeChat(), ask: fakeJev({ semantic: { address_is_the_site: 0.3 } }) });
    expect(s?.status).toBe("needs_review");
    expect(s?.checks.semantic).toEqual(["address_is_the_site: 0.30 (min 0.7)"]);
  });

  it("holds a record with a missing required field", async () => {
    const store = new MemoryStore();
    const s = await processInbound(email(), customer, store, { ...quiet, chat: fakeChat({ ...extracted, work: { description: null } }), ask: fakeJev() });
    expect(s?.status).toBe("needs_review");
    expect(s?.checks.required).toEqual(["work.description"]);
  });

  it("records a failed step and finishes the run as failed", async () => {
    const store = new MemoryStore();
    const badJev: AskJevFn = async () => { throw new Error("gateway down"); };
    const s = await processInbound(email(), customer, store, { ...quiet, chat: fakeChat(), ask: badJev });
    expect(s?.status).toBe("failed");
    const run = store.runs.get(s!.run_id)!;
    expect(run.steps.at(-1)).toMatchObject({ name: "sorted", status: "failed" });
  });

  it("ignores a duplicate message_id", async () => {
    const store = new MemoryStore();
    const e = email();
    await processInbound(e, customer, store, { ...quiet, chat: fakeChat(), ask: fakeJev() });
    expect(await processInbound(e, customer, store, { ...quiet, chat: fakeChat(), ask: fakeJev() })).toBeNull();
    expect(store.runs.size).toBe(1);
  });

  it("fails the cleaned step when the email has no body", async () => {
    const store = new MemoryStore();
    const s = await processInbound(email({ html: null, text: "   " }), customer, store, { ...quiet, chat: fakeChat(), ask: fakeJev() });
    expect(s?.status).toBe("failed");
    expect(s?.error).toContain("no readable body");
  });

  it("passes the configured reader model to the chat function", async () => {
    let seen: string | undefined;
    const chat: ChatJsonFn = async (_s, _u, opts) => { seen = opts?.model; return { content: JSON.stringify(extracted), model: opts?.model ?? "fake", usage: null }; };
    await processInbound(email(), customer, new MemoryStore(), { ...quiet, chat, ask: fakeJev(), models: { extract: "model-b" } });
    expect(seen).toBe("model-b");
  });

  it("drops null and blank extras instead of failing extraction", async () => {
    const withNulls = { ...extracted, extras: { "Asset Serial Number": null, "Asset Number": "", Customer: "TOPS" } };
    const s = await processInbound(email(), customer, new MemoryStore(), { ...quiet, chat: fakeChat(withNulls), ask: fakeJev() });
    expect(s?.status).toBe("ready");
    expect(s?.record?.extras).toEqual({ Customer: "TOPS" });
  });
});
