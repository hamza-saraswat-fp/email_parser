import { describe, it, expect } from "vitest";
import { processInbound } from "./run.js";
import { MemoryStore } from "./memory-store.js";
import { DEFAULT_REQUIRED_FIELDS } from "../schema/record.js";
import type { ChatJsonFn } from "../llm/openrouter.js";
import type { Customer, InboundEmail } from "./types.js";

const customer: Customer = { id: "dev", name: "dev", inbox_id: "parser-dev@agent.fieldpulse.com", required_fields: DEFAULT_REQUIRED_FIELDS };

function email(over: Partial<InboundEmail> = {}): InboundEmail {
  return {
    message_id: `<m-${Math.random()}@test>`,
    inbox_id: customer.inbox_id,
    from_email: "dispatch@servicechannel.com",
    from_name: "ServiceChannel",
    to: ["service@example.com"],
    subject: "New Service Request #1",
    text: null,
    html: "<p>Customer <b>TOPS</b></p><p>PO# 1</p><p>Address 1 Main St</p><p>Problem: light out</p>",
    attachments: [],
    received_at: "2026-09-09T13:12:00.000Z",
    ...over,
  };
}

const extracted = {
  reference: { primary: "1", all: [{ label: "PO#", value: "1" }] },
  requester: { organization: "TOPS" },
  site: { name: null, identifier: null, address: { line1: "1 Main St" }, phone: null },
  work: { description: "light out" },
  priority: { raw: null },
  deadlines: {},
  limits: { not_to_exceed: null },
  extras: {},
  notes: null,
};

// A fake model: the system prompt tells us which step is calling.
function fakeChat(opts: { type?: string; extracted?: unknown } = {}): ChatJsonFn {
  return async (system) => {
    const isClassify = system.includes("email_type (pick exactly one)");
    const content = isClassify
      ? JSON.stringify({ email_type: opts.type ?? "new_request", portal: "servicechannel", confidence: 0.93, reason: "test" })
      : JSON.stringify(opts.extracted ?? extracted);
    return { content, model: "fake", usage: null };
  };
}

describe("processInbound", () => {
  it("runs all five steps and produces a ready record", async () => {
    const store = new MemoryStore();
    const summary = await processInbound(email(), customer, store, { chat: fakeChat(), log: () => {} });
    expect(summary?.status).toBe("ready");
    const run = store.runs.get(summary!.run_id)!;
    expect(run.steps.map((s) => s.name)).toEqual(["received", "cleaned", "classified", "extracted", "checked"]);
    expect(run.record?.reference.primary).toBe("1");
    expect(run.record?.source.portal).toBe("servicechannel");
    expect(run.patch?.status).toBe("ready");
  });

  it("stops after classification for anything that is not a new request", async () => {
    const store = new MemoryStore();
    const summary = await processInbound(email(), customer, store, { chat: fakeChat({ type: "reminder" }), log: () => {} });
    expect(summary?.status).toBe("skipped");
    expect(store.runs.get(summary!.run_id)!.steps.map((s) => s.name)).toEqual(["received", "cleaned", "classified"]);
  });

  it("flags missing required fields as needs_review", async () => {
    const store = new MemoryStore();
    const noDesc = { ...extracted, work: { description: null } };
    const summary = await processInbound(email(), customer, store, { chat: fakeChat({ extracted: noDesc }), log: () => {} });
    expect(summary?.status).toBe("needs_review");
    expect(summary?.required_missing).toEqual(["work.description"]);
  });

  it("records a failed step and finishes the run as failed", async () => {
    const store = new MemoryStore();
    const badChat: ChatJsonFn = async () => ({ content: "not json", model: "fake", usage: null });
    const summary = await processInbound(email(), customer, store, { chat: badChat, log: () => {} });
    expect(summary?.status).toBe("failed");
    const run = store.runs.get(summary!.run_id)!;
    expect(run.steps.at(-1)?.name).toBe("classified");
    expect(run.steps.at(-1)?.status).toBe("failed");
    expect(run.patch?.status).toBe("failed");
  });

  it("ignores a duplicate message_id", async () => {
    const store = new MemoryStore();
    const e = email();
    await processInbound(e, customer, store, { chat: fakeChat(), log: () => {} });
    const again = await processInbound(e, customer, store, { chat: fakeChat(), log: () => {} });
    expect(again).toBeNull();
    expect(store.runs.size).toBe(1);
  });

  it("fails the cleaned step when the email has no body", async () => {
    const store = new MemoryStore();
    const summary = await processInbound(email({ html: null, text: "   " }), customer, store, { chat: fakeChat(), log: () => {} });
    expect(summary?.status).toBe("failed");
    expect(summary?.error).toContain("no readable body");
  });
});
