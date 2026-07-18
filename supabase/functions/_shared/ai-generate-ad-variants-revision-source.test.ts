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

  it("requires a subheadline/kicker revision request to actually change the kicker", () => {
    expect(source).toContain("requiresKickerChange");
    expect(source).toContain(
      "/\\b(?:kicker|eyebrow|sub[\\s-]?headings?|sub[\\s-]?headlines?|sub[\\s-]?lines?|sub[\\s-]?titles?|supporting (?:copy|line|text)|second line|small(?:er)? (?:line|text))\\b/",
    );
    expect(source).toContain("function revisionKickerChanged");
    expect(source).toContain("kicker_unchanged_for_subheadline_feedback");
    expect(source).toContain("function deterministicRevisedKicker");
    expect(source).toContain("revision_deterministic_kicker_fallback");
    expect(source).toContain("REVISION_DETERMINISTIC_KICKER");
    // The kicker counts as visible revision copy so kicker-only changes are
    // accepted and kicker-ignoring candidates can be scored against feedback.
    expect(source).toContain("nextKicker.length > 0 && nextKicker !== previousKicker");
    // Image-only shortcut must not swallow kicker feedback.
    expect(source).toContain("!intent.requiresKickerChange &&");
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
