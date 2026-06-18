import { describe, expect, it } from "vitest";

import { hasLoadingTimedOut } from "./loading-timeout";

describe("hasLoadingTimedOut", () => {
  it("stays false while loading is inactive", () => {
    expect(hasLoadingTimedOut({ active: false, startedAtMs: 0, nowMs: 10_000, timeoutMs: 8_000 })).toBe(false);
  });

  it("stays false before the threshold", () => {
    expect(hasLoadingTimedOut({ active: true, startedAtMs: 1_000, nowMs: 8_999, timeoutMs: 8_000 })).toBe(false);
  });

  it("turns true at the threshold", () => {
    expect(hasLoadingTimedOut({ active: true, startedAtMs: 1_000, nowMs: 9_000, timeoutMs: 8_000 })).toBe(true);
  });
});
