import { describe, it, expect } from "vitest";
import { sortEmail, buildSortQuestions } from "./sort.js";
import { gate } from "./gate.js";
import type { AskJevFn } from "../llm/jev.js";

const base = { from: "x@scalert.com", subject: "New Service Request #1", body: "Customer ACME\nPO# 1", portalHint: "servicechannel" as const };

function fakeJev(over: { type?: string; conf?: number; portal?: string; pconf?: number; dispatch?: number } = {}): AskJevFn {
  return async () => ({
    model: "typesafe-ai/jev",
    usage: null,
    answers: {
      email_type: { type: "choice", choice: over.type ?? "new_request", confidence: over.conf ?? 0.97, probabilities: { new_request: over.conf ?? 0.97 } },
      portal: { type: "choice", choice: over.portal ?? "servicechannel", confidence: over.pconf ?? 0.99, probabilities: { servicechannel: 0.99 } },
      dispatches_new_work: { type: "boolean", boolean: over.dispatch ?? 0.95 },
    },
  });
}

describe("sortEmail", () => {
  it("asks three questions over a bounded state and maps the answers", async () => {
    let seenState: any;
    const ask: AskJevFn = async (state, questions) => { seenState = state; expect(Object.keys(questions)).toEqual(["email_type", "portal", "dispatches_new_work"]); return fakeJev()(state, questions); };
    const r = await sortEmail({ ...base, body: "x".repeat(20_000) }, ask);
    expect(seenState.body.length).toBe(12_000);
    expect(r.email_type).toBe("new_request");
    expect(r.portal).toBe("servicechannel");
    expect(r.dispatches_new_work).toBe(0.95);
  });
  it("rejects an off-list answer", async () => {
    await expect(sortEmail(base, fakeJev({ type: "spam" }))).rejects.toThrow(/off-list/);
  });
  it("puts the sender hint in the portal question", () => {
    const q = buildSortQuestions(base);
    expect(JSON.stringify(q.portal.instructions)).toContain("servicechannel");
  });
});

describe("gate", () => {
  const s = (type: string, conf: number, dispatch = 0.95) => ({
    email_type: type as any, email_type_confidence: conf, email_type_probabilities: {}, portal: "heb" as const, portal_confidence: 1, portal_probabilities: {}, dispatches_new_work: dispatch, model: "m", usage: null,
  });
  it("continues on a confident new request that dispatches work", () => {
    expect(gate(s("new_request", 0.9), 0.7).outcome).toBe("continue");
  });
  it("skips a confident non-request", () => {
    expect(gate(s("reminder", 0.92), 0.7)).toEqual({ outcome: "skip", reason: "reminder at 0.92" });
  });
  it("sends an uncertain sort to a person", () => {
    expect(gate(s("new_request", 0.5), 0.7).outcome).toBe("review");
    expect(gate(s("update", 0.55), 0.7).outcome).toBe("review");
    expect(gate(s("new_request", 0.9, 0.4), 0.7).outcome).toBe("review");
    expect(gate(s("new_request", 0.5), 0.7)).toMatchObject({ reason: expect.stringContaining("sort_uncertain") });
  });
});
