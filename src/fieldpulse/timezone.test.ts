import { describe, it, expect } from "vitest";
import { timezoneForState, wallTimeToUnix } from "./timezone.js";

describe("timezoneForState", () => {
  it("maps codes and names, and falls back", () => {
    expect(timezoneForState("NY")).toBe("America/New_York");
    expect(timezoneForState("or")).toBe("America/Los_Angeles");
    expect(timezoneForState("Texas")).toBe("America/Chicago");
    expect(timezoneForState(null)).toBe("America/Chicago");
    expect(timezoneForState("ZZ", "UTC")).toBe("UTC");
  });
});

describe("wallTimeToUnix", () => {
  it("reads a naive time in the site's zone (winter, EST = UTC-5)", () => {
    expect(wallTimeToUnix("2027-02-24T08:51:00", "America/New_York")).toBe(Date.UTC(2027, 1, 24, 13, 51) / 1000);
  });
  it("handles daylight time (summer, PDT = UTC-7)", () => {
    expect(wallTimeToUnix("2026-09-10T09:30:00", "America/Los_Angeles")).toBe(Date.UTC(2026, 8, 10, 16, 30) / 1000);
  });
  it("respects an explicit offset or Z", () => {
    expect(wallTimeToUnix("2027-02-24T08:51:00Z", "America/New_York")).toBe(Date.UTC(2027, 1, 24, 8, 51) / 1000);
    expect(wallTimeToUnix("2027-02-24T08:51:00-06:00", "America/New_York")).toBe(Date.UTC(2027, 1, 24, 14, 51) / 1000);
  });
  it("accepts a date without a time and rejects garbage", () => {
    expect(wallTimeToUnix("2027-02-24", "America/Chicago")).toBe(Date.UTC(2027, 1, 24, 6, 0) / 1000);
    expect(wallTimeToUnix("next tuesday", "America/Chicago")).toBeUndefined();
    expect(wallTimeToUnix(null, "America/Chicago")).toBeUndefined();
  });
  it("lands on the right side of the spring-forward boundary", () => {
    // 2027-03-14 03:30 local in New York is after the 2am jump: EDT = UTC-4.
    expect(wallTimeToUnix("2027-03-14T03:30:00", "America/New_York")).toBe(Date.UTC(2027, 2, 14, 7, 30) / 1000);
  });
});
