import { describe, expect, it } from "vitest";

import { isAuthBypassEnabled } from "./auth-bypass";

describe("isAuthBypassEnabled", () => {
  it("returns false in production even with bypass params", () => {
    expect(isAuthBypassEnabled({ skipSetup: "1", e2e: "1", isDev: false })).toBe(false);
  });

  it("returns true in dev when either bypass param is set", () => {
    expect(isAuthBypassEnabled({ skipSetup: "1", isDev: true })).toBe(true);
    expect(isAuthBypassEnabled({ e2e: "1", isDev: true })).toBe(true);
  });

  it("returns false when params are missing", () => {
    expect(isAuthBypassEnabled({ isDev: true })).toBe(false);
  });
});
