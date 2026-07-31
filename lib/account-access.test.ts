import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    auth: { signOut: vi.fn() },
  },
}));

import { isAccountAccessBlocked } from "./account-access";

describe("account access", () => {
  it("blocks suspended and archived accounts", () => {
    expect(isAccountAccessBlocked("suspended")).toBe(true);
    expect(isAccountAccessBlocked("archived")).toBe(true);
  });

  it("keeps active, legacy, and unknown account rows usable", () => {
    expect(isAccountAccessBlocked("active")).toBe(false);
    expect(isAccountAccessBlocked(null)).toBe(false);
    expect(isAccountAccessBlocked("legacy")).toBe(false);
  });
});
