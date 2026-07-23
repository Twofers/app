import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const createLayoutSource = readFileSync(join(process.cwd(), "app", "create", "_layout.tsx"), "utf8");

/**
 * Guards the fix for the "Create new offer" redirect flicker.
 *
 * The create layout used to return a standalone spinner while its business /
 * billing gate loaded. That unmounted the <Stack>, which threw away the
 * navigator state, so the next mount rebuilt the stack from getInitialState()
 * and landed on routeNames[0] — the deprecated `quick` shim. The shim renders
 * "Redirecting..." and immediately calls router.replace, which re-entered the
 * layout and looped for ~60s before settling.
 */
describe("create layout navigator stability", () => {
  it("never swaps the navigator out for the loading spinner", () => {
    // The spinner must be an overlay rendered alongside <Stack>, so a loading
    // flip can never destroy the create navigator's state.
    expect(createLayoutSource).toContain("StyleSheet.absoluteFillObject");
    expect(createLayoutSource).toContain("{loading ? (");
    expect(createLayoutSource).not.toMatch(/if\s*\(\s*loading\s*\)\s*\{\s*return/);
  });

  it("keeps the deprecated redirect shims out of the stack's fallback route", () => {
    const screenOrder = [...createLayoutSource.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(screenOrder.length).toBeGreaterThan(0);
    // routeNames[0] is what React Navigation falls back to when the stack has no
    // state to restore. A redirect shim there means an instant re-navigation.
    expect(screenOrder[0]).toBe("ai");
    expect(screenOrder).toContain("quick");
    expect(screenOrder).toContain("ai-compose");
    expect(screenOrder.indexOf("quick")).toBeGreaterThan(screenOrder.indexOf("ai"));
    expect(screenOrder.indexOf("ai-compose")).toBeGreaterThan(screenOrder.indexOf("ai"));
  });

  it("still redirects blocked merchants away once the gate has resolved", () => {
    expect(createLayoutSource).toContain("!loading && blocked && !routeAllowedBeforeActivation");
    expect(createLayoutSource).toContain('<Redirect href={"/(tabs)/account" as Href} />');
  });
});
