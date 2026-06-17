import { describe, expect, it } from "vitest";

import { shouldSkipWebSearchForMenuItem } from "./ai-web-search-gate.ts";

describe("shouldSkipWebSearchForMenuItem", () => {
  it("does not web-search bagel and coffee", () => {
    expect(shouldSkipWebSearchForMenuItem("bagel and coffee")).toBe(true);
  });

  it("skips common cafe items joined with plus", () => {
    expect(shouldSkipWebSearchForMenuItem("latte + muffin")).toBe(true);
  });

  it("allows search for unfamiliar or branded items", () => {
    expect(shouldSkipWebSearchForMenuItem("Cedar Bean Mooncloud seasonal special")).toBe(false);
  });
});
