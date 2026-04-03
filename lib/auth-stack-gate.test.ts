import { describe, expect, it } from "vitest";

import { buildNextFromRoute, shouldBypassAuthStackGate } from "./auth-stack-gate";

describe("shouldBypassAuthStackGate", () => {
  it("allows public roots for signed-out users", () => {
    expect(shouldBypassAuthStackGate({ root: "index", isDev: false })).toBe(true);
    expect(shouldBypassAuthStackGate({ root: "auth-landing", isDev: false })).toBe(true);
    expect(shouldBypassAuthStackGate({ root: "forgot-password", isDev: false })).toBe(true);
    expect(shouldBypassAuthStackGate({ root: "reset-password", isDev: false })).toBe(true);
    expect(shouldBypassAuthStackGate({ root: "auth-callback", isDev: false })).toBe(true);
  });

  it("allows debug diagnostics only in dev", () => {
    expect(shouldBypassAuthStackGate({ root: "debug-diagnostics", isDev: true })).toBe(true);
    expect(shouldBypassAuthStackGate({ root: "debug-diagnostics", isDev: false })).toBe(false);
  });

  it("blocks protected roots for signed-out users", () => {
    expect(shouldBypassAuthStackGate({ root: "(tabs)", isDev: false })).toBe(false);
    expect(shouldBypassAuthStackGate({ root: "deal", isDev: false })).toBe(false);
  });
});

describe("buildNextFromRoute", () => {
  it("builds next path and query from segments + params", () => {
    const next = buildNextFromRoute({
      segments: ["(tabs)", "map"],
      params: { foo: "bar", multi: ["x", "y"] },
    });
    expect(next).toBe("/(tabs)/map?foo=bar&multi=x&multi=y");
  });

  it("falls back to root slash when route is empty", () => {
    expect(buildNextFromRoute({ segments: [], params: {} })).toBe("/");
  });
});
