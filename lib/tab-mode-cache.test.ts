import { describe, expect, it } from "vitest";

import { decodeCachedRole, encodeCachedRole, isLegacyCachedRole } from "./tab-mode-cache";

describe("tab mode cache", () => {
  it("round-trips a role for the matching user", () => {
    const raw = encodeCachedRole("user_1", "business");

    expect(decodeCachedRole(raw, "user_1")).toBe("business");
  });

  it("ignores roles cached for another user", () => {
    const raw = encodeCachedRole("user_1", "business");

    expect(decodeCachedRole(raw, "user_2")).toBeNull();
  });

  it("ignores legacy global role values", () => {
    expect(decodeCachedRole("business", "user_1")).toBeNull();
    expect(isLegacyCachedRole("business")).toBe(true);
  });

  it("ignores malformed or invalid role payloads", () => {
    expect(decodeCachedRole("{", "user_1")).toBeNull();
    expect(decodeCachedRole(JSON.stringify({ v: 1, userId: "user_1", role: "admin" }), "user_1")).toBeNull();
  });
});
