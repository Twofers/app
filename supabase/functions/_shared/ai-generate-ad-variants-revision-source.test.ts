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

    const changedIndex = source.indexOf("const changed = prepared.variants.filter((variant) => hasVisibleRevisionCopyChange(variant, previousAd));");
    const filterIndex = source.indexOf("const feedbackMatched = filterRevisionCandidatesByFeedback({");
    const returnIndex = source.indexOf("return feedbackMatched;", filterIndex);

    expect(changedIndex).toBeGreaterThan(-1);
    expect(filterIndex).toBeGreaterThan(changedIndex);
    expect(returnIndex).toBeGreaterThan(filterIndex);
    expect(source).toContain("revision_feedback_no_candidate_match");
  });
});
