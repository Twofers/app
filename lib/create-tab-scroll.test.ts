import { describe, expect, it } from "vitest";

import {
  CREATE_TAB_EXPANDED_BOTTOM_GAP,
  CREATE_TAB_EXPAND_SCROLL_OFFSET,
  getCreateTabScrollBottom,
  getExpandedSectionScrollY,
} from "./create-tab-scroll";

describe("create tab scroll helpers", () => {
  it("adds extra bottom room for expanded create-tab sections", () => {
    expect(getCreateTabScrollBottom(88)).toBe(88 + CREATE_TAB_EXPANDED_BOTTOM_GAP);
  });

  it("scrolls expanded sections slightly above their measured top", () => {
    expect(getExpandedSectionScrollY(140)).toBe(140 - CREATE_TAB_EXPAND_SCROLL_OFFSET);
  });

  it("keeps scroll targets non-negative and finite", () => {
    expect(getExpandedSectionScrollY(8)).toBe(0);
    expect(getExpandedSectionScrollY(Number.NaN)).toBe(0);
  });
});
