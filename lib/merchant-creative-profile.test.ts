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
    expect(profile.merchantSuppliedPhrases).toEqual(["fresh"]);
  });

  it("keeps safe merchant sentences and drops only sentences with always-banned claims", () => {
    const profile = buildMerchantCreativeProfile({
      businessId: "biz_tacos",
      businessName: "La Esquina",
      category: "restaurant",
      description: "Serves homemade tamales with fresh salsa every day. Rated the #1 taco stop in Irving.",
    });

    expect(profile.merchantNotes).toBe("Serves homemade tamales with fresh salsa every day.");
    expect(profile.merchantNotes).not.toMatch(/rated|#\s?1/i);
    expect(profile.verifiedDifferentiators).toEqual(["Serves homemade tamales with fresh salsa every day."]);
    expect(profile.merchantSuppliedPhrases).toEqual(["homemade", "fresh"]);
  });

  it("never surfaces certification-style claims as merchant-supplied phrases", () => {
    const profile = buildMerchantCreativeProfile({
      businessId: "biz_claims",
      description: "Certified organic and gluten-free menu, rated five stars.",
    });

    expect(profile.merchantNotes).toBeUndefined();
    expect(profile.verifiedDifferentiators).toEqual([]);
    expect(profile.merchantSuppliedPhrases).toBeUndefined();
  });

  it("adds saved menu items as context and filters claim-bearing names", () => {
    const profile = buildMerchantCreativeProfile({
      businessId: "biz_menu",
      businessName: "Cedar Street Cafe",
      category: "cafe",
      savedMenuItemNames: ["Homemade Lasagna", "Award-Winning Ribs", "Iced Vanilla Latte"],
    });

    expect(profile.savedMenuItems).toEqual(["Homemade Lasagna", "Iced Vanilla Latte"]);
    expect(profile.merchantSpecificContextLimited).toBe(false);
    expect(profile.merchantSuppliedPhrases).toContain("homemade");
    expect(profile.verifiedFacts.map((fact) => fact.fact)).toContain("Saved menu item: Homemade Lasagna");

    const block = buildMerchantCreativeProfilePromptBlock(profile);
    expect(block).toContain("Other saved menu items");
    expect(block).toContain("never move the deal onto these");
    expect(block).not.toContain("Award-Winning");
  });

  it("tells the model about merchant-supplied flavor phrases, and forbids inventing them otherwise", () => {
    const withPhrases = buildMerchantCreativeProfile({
      businessId: "biz_flavor",
      description: "Serves house-made pasta and freshly baked focaccia.",
    });
    const block = buildMerchantCreativeProfilePromptBlock(withPhrases);
    expect(block).toContain("Merchant-supplied flavor phrases (the merchant wrote these");
    expect(block).toContain("house-made");

    const sparseBlock = buildMerchantCreativeProfilePromptBlock(buildMerchantCreativeProfile({ businessId: "biz_none" }));
    expect(sparseBlock).toContain("Merchant-supplied flavor phrases: none.");
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
