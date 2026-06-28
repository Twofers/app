import { describe, expect, it } from "vitest";

import { buildCategoryAdPlaybookPromptBlock, getCategoryAdPlaybook, normalizeAdCategory } from "./category-ad-playbooks";

describe("category ad playbooks", () => {
  it("normalizes common local business categories", () => {
    expect(normalizeAdCategory("Coffee shop")).toBe("coffee_cafe");
    expect(normalizeAdCategory("Bakery and desserts")).toBe("bakery_dessert");
    expect(normalizeAdCategory("Hair salon")).toBe("beauty_salon");
    expect(normalizeAdCategory("restaurant")).toBe("restaurant_food");
    expect(normalizeAdCategory("cafe")).toBe("coffee_cafe");
    expect(normalizeAdCategory("retail")).toBe("retail");
    expect(normalizeAdCategory("gym")).toBe("fitness_wellness");
    expect(normalizeAdCategory("services")).toBe("local_service");
    expect(normalizeAdCategory("unknown")).toBe("general_local_business");
  });

  it("normalizes free-form lookup categories into specific playbooks", () => {
    expect(normalizeAdCategory("Juice bar")).toBe("beverage_smoothie");
    expect(normalizeAdCategory("Wine bar")).toBe("bar_beverage");
    expect(normalizeAdCategory("Pet grooming")).toBe("pet_services");
    expect(normalizeAdCategory("Auto repair shop")).toBe("auto_service");
    expect(normalizeAdCategory("HVAC contractor")).toBe("home_service");
    expect(normalizeAdCategory("Dry cleaning")).toBe("cleaning_laundry");
    expect(normalizeAdCategory("Tax preparation")).toBe("professional_service");
    expect(normalizeAdCategory("Florist")).toBe("florist_gift");
    expect(normalizeAdCategory("Bowling alley")).toBe("events_entertainment");
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
