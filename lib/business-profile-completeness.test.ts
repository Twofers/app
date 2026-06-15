import { describe, expect, it } from "vitest";

import { calculateProfileCompleteness } from "./business-profile-completeness";

const completeProfile = {
  name: "Demo Cafe",
  address: "123 Main St",
  phone: "(512) 555-0100",
  category: "Cafe",
  hours_text: "Mon-Fri 7a-4p",
  short_description: "Neighborhood coffee and pastries.",
  contact_name: "Alex Kim",
  business_email: "hello@example.com",
};

describe("business profile completeness", () => {
  it("marks a complete profile as 100 percent with no hint", () => {
    expect(calculateProfileCompleteness(completeProfile)).toEqual({
      percentage: 100,
      filledCount: 8,
      totalCount: 8,
      missingFields: [],
      nextHint: null,
    });
  });

  it("asks for category only when the canonical category field is missing", () => {
    const result = calculateProfileCompleteness({ ...completeProfile, category: " " });

    expect(result.missingFields).toContain("category");
    expect(result.nextHint).toBe("account.profileHintCategory");
  });

  it("moves to the next missing field when category exists", () => {
    const result = calculateProfileCompleteness({ ...completeProfile, hours_text: "" });

    expect(result.missingFields).toEqual(["hours_text"]);
    expect(result.nextHint).toBe("account.profileHintHours");
  });

  it("counts address separately from category", () => {
    const result = calculateProfileCompleteness({ ...completeProfile, address: "" });

    expect(result.missingFields).toEqual(["address"]);
    expect(result.nextHint).toBe("account.profileHintAddress");
  });
});
