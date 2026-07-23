import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-generate-ad-variants", "index.ts"),
  "utf8",
);

describe("ai-generate-ad-variants revision source guard", () => {
  it("filters changed revision candidates against merchant feedback before selection", () => {
    expect(source).toContain("type RevisionFeedbackIntent");
    expect(source).toContain("function extractBannedRevisionTerms");
    expect(source).toContain("requiresHeadlineChange");
    expect(source).toContain("headline_unchanged_for_headline_feedback");
    expect(source).toContain("uses_banned_feedback_term");
    expect(source).toContain("if (intent.requiresHeadlineChange && !revisionHeadlineChanged(params.selected, params.previousAd)) return true;");

    const changedIndex = source.indexOf("const changed = prepared.variants.filter((variant) => hasVisibleRevisionCopyChange(variant, previousAd));");
    const filterIndex = source.indexOf("const feedbackMatched = filterRevisionCandidatesByFeedback({");
    const returnIndex = source.indexOf("return feedbackMatched;", filterIndex);

    expect(changedIndex).toBeGreaterThan(-1);
    expect(filterIndex).toBeGreaterThan(changedIndex);
    expect(returnIndex).toBeGreaterThan(filterIndex);
    expect(source).toContain("revision_feedback_no_candidate_match");
  });

  it("still recognises subheadline feedback as copy feedback, without enforcing a kicker change", () => {
    // R12: the poster has no kicker slot, so the kicker is permanently empty. The intent
    // detection stays — it is what stops the image-only shortcut swallowing this feedback —
    // but the enforcement had to go: `kicker_unchanged_for_subheadline_feedback` was a HARD
    // FAIL, and against a permanently-empty kicker it would have failed EVERY candidate for
    // any feedback mentioning a subheadline. Subheadline feedback now means the card
    // description, and hasVisibleRevisionCopyChange still rejects a no-op revision.
    expect(source).toContain("requiresKickerChange");
    expect(source).toContain(
      "/\\b(?:kicker|eyebrow|sub[\\s-]?headings?|sub[\\s-]?headlines?|sub[\\s-]?lines?|sub[\\s-]?titles?|supporting (?:copy|line|text)|second line|small(?:er)? (?:line|text))\\b/",
    );
    // Image-only shortcut must not swallow subheadline feedback.
    expect(source).toContain("!intent.requiresKickerChange &&");
    // The enforcement and its backstop are gone, and must not come back while the poster
    // has no kicker slot — they would hard-fail every candidate.
    expect(source).not.toContain("kicker_unchanged_for_subheadline_feedback");
    expect(source).not.toContain("function revisionKickerChanged");
    expect(source).not.toContain("function deterministicRevisedKicker");
    expect(source).not.toContain("REVISION_DETERMINISTIC_KICKER");
    // Nothing may feed a kicker into the poster spec.
    expect(source).not.toContain("subline: copy.poster_kicker");
    expect(source).toContain("subline: null,");
  });

  it("rejects poster candidates whose text cannot fit the poster layout", () => {
    expect(source).toContain('import { POSTER_TEXT_LIMITS } from "../../../lib/poster/posterPolicy.ts";');
    expect(source).toContain("POSTER_HEADLINE_OVER_LIMIT");
    expect(source).toContain("POSTER_KICKER_OVER_LIMIT");
    expect(source).toContain("posterVisibleLength(candidate.headline) > POSTER_TEXT_LIMITS.headline");
    expect(source).toContain("posterVisibleLength(candidate.poster_kicker) > POSTER_TEXT_LIMITS.subline");
    expect(source).toContain("clip(selected.poster_kicker, POSTER_TEXT_LIMITS.subline)");
  });

  it("keeps deterministic fallback image requests copy-only and provider-free", () => {
    const deterministicStart = source.indexOf('if (params.imageSourceMode === "deterministic_fallback")');
    const openAiStart = source.indexOf('if (params.imageProviderConfig.primaryProvider === "openai")', deterministicStart);
    const deterministicBlock = source.slice(deterministicStart, openAiStart);

    expect(deterministicStart).toBeGreaterThan(-1);
    expect(openAiStart).toBeGreaterThan(deterministicStart);
    expect(deterministicBlock).toContain('source: "copy_only"');
    expect(deterministicBlock).toContain('skippedImageQaTelemetry("deterministic_fallback")');
    expect(deterministicBlock).toContain('provider: "none"');
    expect(deterministicBlock).toContain("estimatedCostUsd: 0");
    expect(deterministicBlock).not.toContain("openAiFallback");
    expect(deterministicBlock).not.toContain("produceFallbackImage");
  });
});
