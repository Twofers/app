import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A photo the image providers refuse must not block the deal.
 *
 * Both providers decline some subjects outright — an item the shop does not
 * stock, a business that never imported a menu, or simply an awkward thing to
 * depict. The old behaviour returned 502 IMAGE_REQUIRED, and "Try again" could
 * never recover because the retry asks for the same picture. The poster renders
 * on the template gradient without a photo (AdPosterCanvas), so the ad is
 * publishable; these contracts pin that both halves agree on it.
 */
const fnSource = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-generate-ad-variants", "index.ts"),
  "utf8",
);
const createSource = readFileSync(join(process.cwd(), "app", "create", "ai.tsx"), "utf8");
const posterCanvas = readFileSync(
  join(process.cwd(), "components", "poster", "AdPosterCanvas.tsx"),
  "utf8",
);

describe("ai-generate-ad-variants: a missing image is not fatal", () => {
  it("no longer returns the IMAGE_REQUIRED failure response", () => {
    expect(fnSource).not.toMatch(/error_code:\s*"IMAGE_REQUIRED"/);
    expect(fnSource).not.toMatch(/"AI image generation failed\. Try again\."/);
  });

  it("reports the missing photo on the success payload instead", () => {
    expect(fnSource).toMatch(/image_fallback: imageFallback/);
    expect(fnSource).toMatch(/reason: "IMAGE_UNAVAILABLE"/);
  });

  it("still refuses to charge for an ad that shipped without a photo", () => {
    // The reserved revision credit is released, and the commit is now the
    // else-branch — so a no-image generation can never fall into it.
    expect(fnSource).toMatch(/if \(imageProductionFailed\) \{[\s\S]{0,600}?releaseReservedChargeableRevision\("image_failed"\)/);
    expect(fnSource).toMatch(/\} else if \(chargeableRevisionCredit\) \{/);
  });

  it("still records the failure for telemetry", () => {
    // Accounting and measurement are deliberately unchanged: only the merchant's
    // options widened. If this stops matching, a missing image became invisible.
    expect(fnSource).toMatch(/failure_reason: productionSuccess \? null : "IMAGE_NULL"/);
    expect(fnSource).toMatch(/const productionSuccess = !imageProductionFailed;/);
    expect(fnSource).toMatch(/event: "image_fallback_gradient"/);
  });
});

describe("create screen: a missing image continues into review", () => {
  it("does not abort first generation when no image came back", () => {
    // The old guard returned early with an error banner, which reproduced the
    // server's hard failure on the client even after the server stopped doing it.
    expect(createSource).toMatch(/const generatedWithoutImage = !imageVersionStoragePath\(normalizedAd\);/);
  });

  it("still aborts a REVISION with no image, on purpose", () => {
    // Revision is the opposite case: the merchant already has an ad with a photo
    // and asked to change it. Accepting an imageless result there would silently
    // swap their photo for a gradient. Failing keeps the previous ad intact, so
    // exactly one NO_IMAGE_RETURNED remains and it belongs to the revision path.
    const occurrences = createSource.match(/error_code: "NO_IMAGE_RETURNED"/g) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(createSource).toMatch(
      /AiAdsEvents\.REVISION_FAILED,[\s\S]{0,400}?error_code: "NO_IMAGE_RETURNED"/,
    );
  });

  it("tells the merchant why the ad has no photo", () => {
    expect(createSource).toMatch(/createAi\.noticeImagelessAd/);
    expect(createSource).toMatch(/tone: "info"/);
  });

  it("keeps the imageless case distinguishable in analytics", () => {
    expect(createSource).toMatch(/generated_without_image: generatedWithoutImage/);
  });
});

describe("the gradient poster this relies on", () => {
  it("AdPosterCanvas still renders a background when there is no photo", () => {
    // If this ever becomes unconditional on imageUri, an imageless ad would
    // render as a blank card and the fallback above would stop being safe.
    expect(posterCanvas).toMatch(/imageUri \?/);
    expect(posterCanvas).toMatch(/PosterBackground/);
  });
});
