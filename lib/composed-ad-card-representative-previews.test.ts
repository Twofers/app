import { describe, expect, it } from "vitest";
import { validateAdPresentationSpec } from "./ad-presentation-spec";
import {
  buildRepresentativeComposedAdPreviewCases,
  resolveRepresentativeComposedAdPreview,
  summarizeRepresentativeComposedAdPreviewAcceptance,
} from "./composed-ad-card-representative-previews";

describe("representative composed ad card previews", () => {
  it("covers the owner-review acceptance matrix without publishing", () => {
    expect(buildRepresentativeComposedAdPreviewCases().map((preview) => preview.id)).toEqual([
      "coffee-drink-offer",
      "pastry-offer",
      "meal-multiple-items",
      "beauty-service-offer",
      "clean-negative-space",
      "busy-background",
      "storefront-image",
      "logo-forward-image",
      "generated-image",
      "ai-edited-photo",
      "very-long-merchant-name",
      "long-exact-item-names",
      "live-quantity-limited",
      "scheduled-deal",
      "ended-deal",
      "no-photo-deterministic-fallback",
    ]);
  });

  it("resolves every representative preview to a valid nonblank presentation", () => {
    for (const preview of buildRepresentativeComposedAdPreviewCases()) {
      const resolved = resolveRepresentativeComposedAdPreview(preview);
      const presentationValidation = validateAdPresentationSpec(resolved.presentation);

      expect(presentationValidation.valid, preview.id).toBe(true);
      expect(resolved.presentation.imageAssetId, preview.id).toBe(preview.imageAssetId);
      expect(resolved.presentationHash, preview.id).toMatch(/^adp_[0-9a-f]{16}$/);
      expect(resolved.compositeQa.available, preview.id).toBe(true);
      expect(resolved.compositeQa.decision, preview.id).not.toBe("unavailable");
      expect(resolved.recommendedTemplateId, preview.id).toBeTruthy();
    }
  });

  it("uses safe templates for busy, scheduled, ended, and no-photo previews", () => {
    const resolved = new Map(
      buildRepresentativeComposedAdPreviewCases().map((preview) => [
        preview.id,
        resolveRepresentativeComposedAdPreview(preview),
      ]),
    );

    expect(resolved.get("busy-background")?.recommendedTemplateId).toBe("split_offer_panel");
    expect(resolved.get("no-photo-deterministic-fallback")?.recommendedTemplateId).toBe("split_offer_panel");
    expect(resolved.get("scheduled-deal")?.recommendedTemplateId).not.toBe("live_drop_card");
    expect(resolved.get("ended-deal")?.recommendedTemplateId).not.toBe("live_drop_card");
    expect(resolved.get("live-quantity-limited")?.recommendedTemplateId).toBe("live_drop_card");
  });

  it("summarizes the local owner-review acceptance matrix", () => {
    const cases = buildRepresentativeComposedAdPreviewCases();
    const summary = summarizeRepresentativeComposedAdPreviewAcceptance(cases);
    const countedDecisions = Object.values(summary.compositeQaDecisionCounts).reduce(
      (sum, count) => sum + (count ?? 0),
      0,
    );

    expect(summary.totalCases).toBe(cases.length);
    expect(summary.rows.map((row) => row.caseId)).toEqual(cases.map((preview) => preview.id));
    expect(summary.rows.every((row) => /^adp_[0-9a-f]{16}$/.test(row.presentationHash))).toBe(true);
    expect(summary.rows.every((row) => row.recommendedTemplateId.length > 0)).toBe(true);
    expect(countedDecisions).toBe(summary.totalCases);
    expect(summary.templateCounts.split_offer_panel ?? 0).toBeGreaterThanOrEqual(2);
    expect(summary.blockedCaseIds).toEqual([]);
    expect(summary.unavailableCaseIds).toEqual([]);
    expect(summary.rows.find((row) => row.caseId === "busy-background")?.recommendedTemplateId).toBe(
      "split_offer_panel",
    );
    expect(summary.rows.find((row) => row.caseId === "live-quantity-limited")?.liveStatus).toBe("live");
    expect(summary.rows.find((row) => row.caseId === "live-quantity-limited")?.recommendedTemplateId).toBe(
      "live_drop_card",
    );
  });
});
