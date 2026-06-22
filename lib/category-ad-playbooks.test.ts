import { describe, expect, it } from "vitest";

import { buildCategoryAdPlaybookPromptBlock, getCategoryAdPlaybook, normalizeAdCategory } from "./category-ad-playbooks";

describe("category ad playbooks", () => {
  it("normalizes common local business categories", () => {
    expect(normalizeAdCategory("Coffee shop")).toBe("coffee_cafe");
    expect(normalizeAdCategory("Bakery and desserts")).toBe("bakery_dessert");
    expect(normalizeAdCategory("Hair salon")).toBe("beauty_salon");
    expect(normalizeAdCategory("unknown")).toBe("general_local_business");
  });

  it("provides conservative prompt guidance for unknown categories", () => {
    const playbook = getCategoryAdPlaybook("mystery category");
    expect(playbook.normalizedCategory).toBe("general_local_business");
    expect(playbook.avoid).toContain("unsupported claims");

    const block = buildCategoryAdPlaybookPromptBlock("coffee");
    expect(block).toContain("CATEGORY PLAYBOOK");
    expect(block).toContain("coffee_cafe");
    expect(block).toContain("coffee run");
  });
});
