import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-generate-ad-variants", "index.ts"),
  "utf8",
);

describe("ai-generate-ad-variants telemetry source guard", () => {
  it("persists total request latency in ad generation log payloads", () => {
    const telemetryIndex = source.indexOf("function buildGenerationTelemetry(");
    const handlerIndex = source.indexOf("Deno.serve(async (req) =>");
    const logIndex = source.indexOf("response_payload: buildGenerationTelemetry({");

    expect(telemetryIndex).toBeGreaterThan(-1);
    expect(handlerIndex).toBeGreaterThan(telemetryIndex);
    expect(logIndex).toBeGreaterThan(handlerIndex);

    const telemetryBlock = source.slice(telemetryIndex, handlerIndex);
    const logBlock = source.slice(logIndex - 300, logIndex + 500);

    expect(source).toMatch(/const requestStartedAtMs = Date\.now\(\)/);
    expect(source).toMatch(/const stageTimingsMs:\s*Record<string,\s*number>/);
    expect(source).toMatch(/const timeStage = async <T>/);
    expect(telemetryBlock).toMatch(/totalLatencyMs:\s*number/);
    expect(telemetryBlock).toMatch(/total_latency_ms:\s*totalLatencyMs/);
    expect(telemetryBlock).toMatch(/stage_timings_ms:\s*params\.stageTimingsMs/);
    expect(logBlock).toMatch(/totalLatencyMs:\s*Date\.now\(\) - requestStartedAtMs/);
    expect(logBlock).toMatch(/stageTimingsMs/);
  });

  it("includes elapsed latency when copy generation fails before image work", () => {
    const failureIndex = source.indexOf('failure_reason: "COPY_FAILED"');
    const failureBlock = source.slice(failureIndex, failureIndex + 500);

    expect(failureIndex).toBeGreaterThan(-1);
    expect(failureBlock).toMatch(/total_latency_ms:\s*Date\.now\(\) - requestStartedAtMs/);
    expect(failureBlock).toMatch(/stage_timings_ms:\s*stageTimingsMs/);
  });

  it("attaches multilingual localization bundles only behind PR3 flags", () => {
    const helperIndex = source.indexOf("function shouldBuildLocalizationBundle()");
    const handlerIndex = source.indexOf("Deno.serve(async (req) =>");
    const bundleIndex = source.indexOf("generateVerifiedAdLocalizationBundle({");
    const adIndex = source.indexOf("const ad: SingleAd = {");
    const logIndex = source.indexOf("response_payload: buildGenerationTelemetry({");

    expect(helperIndex).toBeGreaterThan(-1);
    expect(handlerIndex).toBeGreaterThan(helperIndex);
    expect(bundleIndex).toBeGreaterThan(handlerIndex);
    expect(adIndex).toBeGreaterThan(bundleIndex);
    expect(logIndex).toBeGreaterThan(adIndex);

    const helperBlock = source.slice(helperIndex, handlerIndex);
    const bundleBlock = source.slice(bundleIndex - 700, adIndex);
    const adBlock = source.slice(adIndex, logIndex);
    const telemetryBlock = source.slice(source.indexOf("function localizationTelemetry("), handlerIndex);

    expect(helperBlock).toMatch(/AI_V5_DETERMINISTIC_LANGUAGE_FALLBACK_ENABLED/);
    expect(helperBlock).toMatch(/AI_V5_PERSUASIVE_TRANSCRATION_ENABLED/);
    expect(bundleBlock).toMatch(/sourceLocale/);
    expect(bundleBlock).toMatch(/targetLocales:\s*\[\.\.\.SUPPORTED_LOCALES\]/);
    expect(bundleBlock).toMatch(/adLocalizationOfferFactsFromDefinition\(offerDefinitionFacts\)/);
    expect(bundleBlock).toMatch(/providerEnabled:\s*envFlag\("AI_V5_PERSUASIVE_TRANSCRATION_ENABLED", false\)/);
    expect(bundleBlock).toMatch(/repairEnabled:\s*envFlag\("AI_V5_TRANSLATION_QA_ENABLED", false\)/);
    expect(bundleBlock).toMatch(/semanticQaEnabled:\s*envFlag\("AI_V5_TRANSLATION_QA_ENABLED", false\)/);
    expect(bundleBlock).toMatch(/logTextProviderAttempts\(costContext, "ad_localization_transcreation"/);
    expect(bundleBlock).toMatch(/logTextProviderAttempts\(costContext, "ad_localization_translation_qa"/);
    expect(bundleBlock).toMatch(/logTextProviderAttempts\(costContext, "ad_localization_repaired_translation_qa"/);
    expect(bundleBlock).toMatch(/logTextProviderAttempts\(costContext, "ad_localization_repair"/);
    expect(adBlock).toMatch(/localization_bundle:\s*localizationResult\?\.bundle \?\? null/);
    expect(adBlock).toMatch(/localization_status:\s*localizationResult/);
    expect(adBlock).toMatch(/semantic_qa_provider:\s*localizationResult\.semanticQa\.provider/);
    expect(telemetryBlock).toMatch(/localization_bundle_hash/);
    expect(telemetryBlock).toMatch(/deterministic_fallback_locales/);
    expect(telemetryBlock).toMatch(/semantic_qa:\s*qaReviewTelemetry\(result\.semanticQa\)/);
    expect(telemetryBlock).toMatch(/repaired_semantic_qa:\s*qaReviewTelemetry\(result\.repairedSemanticQa\)/);
    expect(telemetryBlock).toMatch(/repairTargetLocales/);
    expect(source).toMatch(/localizationResult\?\.semanticQa\.attempts/);
    expect(source).toMatch(/localizationResult\?\.repairedSemanticQa\.attempts/);
  });

  it("runs localization concurrently with the image chain, not after it", () => {
    // Localization needs offer facts and copy, never the generated image, so it is
    // kicked off before produceImage and awaited after. Serialized it added a
    // measured ~8s to a ~44.6s generation. If someone moves the call back below the
    // image stage that cost silently returns, so the ordering is pinned here.
    const bundleIndex = source.indexOf("generateVerifiedAdLocalizationBundle({");
    const imageStageIndex = source.indexOf('timeStage("image"');
    const awaitIndex = source.indexOf("localizationResult = await localizationPromise;");

    expect(bundleIndex).toBeGreaterThan(-1);
    expect(imageStageIndex).toBeGreaterThan(-1);
    expect(awaitIndex).toBeGreaterThan(-1);
    expect(bundleIndex).toBeLessThan(imageStageIndex);
    expect(awaitIndex).toBeGreaterThan(imageStageIndex);

    // The promise must carry a rejection sink: if produceImage throws, nothing
    // awaits it and an unhandled rejection can take down the isolate.
    expect(source).toMatch(/localizationPromise\?\.catch\(\(\) => \{\}\)/);
    // sourceAssetIds is the only image-derived field, so the post-image definition
    // is a spread of the facts localization already used — never a second build.
    expect(source).toMatch(
      /\{ \.\.\.offerDefinitionFacts, sourceAssetIds: \[imageResult\.posterStoragePath\] \}/,
    );
    expect(source).toMatch(/sourceAssetIds: \[\],/);
  });

  it("builds sanitized poster drafts from the locked offer contract when requested", () => {
    expect(source).toMatch(/function parseCreativeRequest/);
    expect(source).toMatch(/creativeRequest\.imageAspectRatio/);
    expect(source).toMatch(/buildPosterSpecFromOfferDefinition/);
    expect(source).toMatch(/choosePosterTemplateForOffer/);
    expect(source).toMatch(/poster:\s*posterDraft/);
    expect(source).toMatch(/requested_aspect_ratio/);
  });

  it("treats copy-only image fallback as an image production failure", () => {
    expect(source).toContain("const imageProductionFailed = imageResult.posterStoragePath === null;");
    expect(source).not.toContain('imageResult.source !== "copy_only"');
    expect(source).toContain('error_code: "IMAGE_REQUIRED"');
  });
});
