import { describe, expect, it } from "vitest";
import { isFutureScheduledPublish } from "./recent-publish";

describe("isFutureScheduledPublish", () => {
  const now = Date.parse("2026-08-02T12:00:00.000Z");

  it("identifies only valid future start times as scheduled", () => {
    expect(isFutureScheduledPublish("2026-08-02T12:01:00.000Z", now)).toBe(true);
    expect(isFutureScheduledPublish("2026-08-02T12:00:00.000Z", now)).toBe(false);
    expect(isFutureScheduledPublish("not-a-date", now)).toBe(false);
    expect(isFutureScheduledPublish(null, now)).toBe(false);
  });
});
