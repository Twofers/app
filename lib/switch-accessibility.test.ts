import { describe, expect, it } from "vitest";

import { getSwitchAccessibilityState } from "./switch-accessibility";

describe("switch accessibility", () => {
  it("announces checked state", () => {
    expect(getSwitchAccessibilityState(true)).toEqual({ checked: true });
    expect(getSwitchAccessibilityState(false)).toEqual({ checked: false });
  });

  it("includes disabled state only when disabled", () => {
    expect(getSwitchAccessibilityState(true, true)).toEqual({ checked: true, disabled: true });
  });
});
