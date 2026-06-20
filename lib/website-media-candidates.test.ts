import { describe, expect, it } from "vitest";

import { filterWebsiteMediaCandidates, type WebsiteMediaCandidateInput } from "./website-media-candidates";

const sourcePageUrl = "https://cedarbean.example/menu";

function candidate(overrides: Partial<WebsiteMediaCandidateInput>): WebsiteMediaCandidateInput {
  return {
    id: overrides.id ?? "photo-1",
    url: overrides.url ?? "/photos/latte.jpg",
    sourcePageUrl: overrides.sourcePageUrl ?? sourcePageUrl,
    sourceKind: overrides.sourceKind ?? "img",
    width: overrides.width ?? 1200,
    height: overrides.height ?? 900,
    mimeType: overrides.mimeType ?? "image/jpeg",
    altText: overrides.altText ?? "Latte on the counter",
    ...overrides,
  };
}

describe("website media candidate filtering", () => {
  it("accepts useful same-site photos and normalizes relative URLs", () => {
    const result = filterWebsiteMediaCandidates([candidate({ id: "latte" })]);

    expect(result.acceptedPhotos).toHaveLength(1);
    expect(result.acceptedPhotos[0]).toMatchObject({
      status: "accepted",
      classification: "photo",
      candidate: {
        id: "latte",
        normalizedUrl: "https://cedarbean.example/photos/latte.jpg",
      },
    });
    expect(result.logoCandidates).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });

  it("classifies business logos separately instead of rejecting them as icons", () => {
    const result = filterWebsiteMediaCandidates([
      candidate({
        id: "logo",
        url: "/assets/logo.png",
        sourceKind: "schema_logo",
        altText: "Cedar Bean logo",
        width: 180,
        height: 180,
        mimeType: "image/png",
      }),
    ]);

    expect(result.logoCandidates).toHaveLength(1);
    expect(result.logoCandidates[0]).toMatchObject({
      status: "accepted",
      classification: "logo",
      candidate: { id: "logo" },
    });
  });

  it("rejects pixels, icons, payment/social logos, marketplace widgets, unsupported files, and tiny photos", () => {
    const result = filterWebsiteMediaCandidates([
      candidate({ id: "pixel", url: "/pixel.gif", width: 1, height: 1, mimeType: "image/gif" }),
      candidate({ id: "icon", url: "/favicon.png", width: 64, height: 64, mimeType: "image/png" }),
      candidate({ id: "visa", url: "/payments/visa.png", altText: "Visa accepted", width: 300, height: 120 }),
      candidate({ id: "widget", url: "https://yelp.com/widget/photo.jpg", embeddedHost: "yelp.com" }),
      candidate({ id: "pdf", url: "/menu.pdf", mimeType: "application/pdf" }),
      candidate({ id: "tiny", url: "/small/product.jpg", width: 250, height: 180 }),
    ]);

    expect(result.acceptedPhotos).toHaveLength(0);
    expect(result.rejected.map((decision) => decision.status === "rejected" && decision.reason)).toEqual([
      "TRACKING_PIXEL",
      "ICON_OR_SPRITE",
      "PAYMENT_OR_SOCIAL_LOGO",
      "MARKETPLACE_OR_REVIEW_WIDGET",
      "UNSUPPORTED_MIME",
      "TOO_SMALL_FOR_AD_USE",
    ]);
  });

  it("deduplicates by hash before showing candidates to the owner", () => {
    const result = filterWebsiteMediaCandidates([
      candidate({ id: "hero-a", url: "/photos/hero-a.jpg", sha256: "same-hash" }),
      candidate({ id: "hero-b", url: "/photos/hero-b.jpg", sha256: "same-hash" }),
    ]);

    expect(result.acceptedPhotos.map((decision) => decision.status === "accepted" && decision.candidate.id)).toEqual([
      "hero-a",
    ]);
    expect(result.rejected).toContainEqual(
      expect.objectContaining({
        status: "rejected",
        reason: "DUPLICATE",
        candidate: expect.objectContaining({ id: "hero-b" }),
      }),
    );
  });

  it("keeps reviewable but lower-quality photos with owner-facing warnings", () => {
    const result = filterWebsiteMediaCandidates([
      candidate({
        id: "text-heavy",
        url: "/photos/menu-board.jpg",
        width: 900,
        height: 600,
        textDominanceScore: 0.8,
        blurScore: 0.72,
        compressionScore: 0.8,
      }),
    ]);

    expect(result.acceptedPhotos[0]).toMatchObject({
      status: "accepted",
      warnings: ["TEXT_HEAVY", "BLURRY", "HEAVILY_COMPRESSED"],
    });
  });

  it("caps the first approval gallery and reports pre-filter truncation", () => {
    const inputs = Array.from({ length: 6 }, (_, index) =>
      candidate({
        id: `photo-${index}`,
        url: `/photos/${index}.jpg`,
        sha256: `hash-${index}`,
      }),
    );

    const result = filterWebsiteMediaCandidates(inputs, {
      maxCandidatesBeforeFiltering: 5,
      maxUsefulThumbnails: 3,
    });

    expect(result.acceptedPhotos).toHaveLength(3);
    expect(result.overflow).toHaveLength(2);
    expect(result.truncatedBeforeFiltering).toBe(1);
  });
});
