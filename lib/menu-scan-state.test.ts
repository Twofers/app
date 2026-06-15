import { describe, expect, it } from "vitest";

import { getMenuScanEmptyStateKey, isMenuScanBusy } from "./menu-scan-state";

describe("menu scan state", () => {
  it("shows first-use guidance while idle", () => {
    expect(getMenuScanEmptyStateKey("idle")).toBe("menuScan.idleEmptyState");
  });

  it("hides empty copy while picking or analyzing a photo", () => {
    expect(isMenuScanBusy("pickingPhoto")).toBe(true);
    expect(isMenuScanBusy("analyzing")).toBe(true);
    expect(getMenuScanEmptyStateKey("pickingPhoto")).toBeNull();
    expect(getMenuScanEmptyStateKey("analyzing")).toBeNull();
  });

  it("shows no-items copy only after an empty scan result", () => {
    expect(getMenuScanEmptyStateKey("emptyResult")).toBe("menuScan.emptyExtract");
  });

  it("shows recovery copy after a real scan error", () => {
    expect(getMenuScanEmptyStateKey("error")).toBe("menuScan.errorEmptyState");
  });
});
