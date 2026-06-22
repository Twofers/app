import { describe, expect, it } from "vitest";

import { buildMerchantCreativeProfile, buildMerchantCreativeProfilePromptBlock } from "./merchant-creative-profile";

describe("merchant creative profile", () => {
  it("derives verified local context without accepting risky claims", () => {
    const profile = buildMerchantCreativeProfile({
      businessId: "biz_123",
      businessName: "Cedar Street Cafe",
      category: "Coffee shop",
      tone: "friendly, direct",
      location: "Downtown Grapevine",
      address: "9460 N MacArthur Blvd, Irving, TX 75063",
      description: "Best rated cafe with fresh pastries and guaranteed smiles.",
      itemHint: "Buy a coffee and get a bagel free",
      research: { item_name: "coffee and bagel", description: "", is_familiar: true },
    });

    expect(profile.normalizedCategory).toBe("coffee_cafe");
    expect(profile.neighborhood).toBe("Downtown Grapevine");
    expect(profile.signatureItems).toContain("coffee and bagel");
    expect(profile.merchantNotes).toBeUndefined();
    expect(profile.verifiedDifferentiators).toEqual([]);
    expect(profile.prohibitedClaims).toContain("best or comparative claims");
    expect(profile.merchantSpecificContextLimited).toBe(false);
  });

  it("marks sparse profiles as context-limited and renders a safe prompt block", () => {
    const profile = buildMerchantCreativeProfile({ businessId: "biz_sparse" });
    expect(profile.merchantSpecificContextLimited).toBe(true);

    const block = buildMerchantCreativeProfilePromptBlock(profile);
    expect(block).toContain("MERCHANT CREATIVE PROFILE");
    expect(block).toContain("Merchant-specific context limited: true");
    expect(block).toContain("No merchant-specific facts beyond the offer were verified");
  });
});
