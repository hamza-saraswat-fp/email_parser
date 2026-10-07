import { describe, it, expect } from "vitest";
import { checkRequired } from "./check.js";
import { DEFAULT_REQUIRED_FIELDS } from "../schema/record.js";

const base = {
  reference: { primary: "363163523" },
  site: { name: "ROBINSON RD", address: { line1: "3035 Niagara Falls Blvd" } },
  work: { description: "Light bulb is out" },
};

describe("checkRequired", () => {
  it("passes when every requirement is present", () => {
    expect(checkRequired(base, DEFAULT_REQUIRED_FIELDS)).toEqual([]);
  });

  it("reports the missing requirement by its full spec", () => {
    const rec = { ...base, work: { description: "   " } };
    expect(checkRequired(rec, DEFAULT_REQUIRED_FIELDS)).toEqual(["work.description"]);
  });

  it("treats a|b as satisfied when either side is present", () => {
    const noLine1 = { ...base, site: { name: "ROBINSON RD", address: { line1: null } } };
    expect(checkRequired(noLine1, DEFAULT_REQUIRED_FIELDS)).toEqual([]);
    const neither = { ...base, site: { name: null, address: {} } };
    expect(checkRequired(neither, DEFAULT_REQUIRED_FIELDS)).toEqual(["site.address.line1|site.name"]);
  });

  it("handles missing branches and numbers", () => {
    expect(checkRequired({}, ["limits.not_to_exceed.amount"])).toEqual(["limits.not_to_exceed.amount"]);
    expect(checkRequired({ limits: { not_to_exceed: { amount: 0 } } }, ["limits.not_to_exceed.amount"])).toEqual([]);
  });
});
