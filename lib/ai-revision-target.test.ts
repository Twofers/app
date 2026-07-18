import { describe, expect, it } from "vitest";

import { copyOnlyRevisionTargetForFeedback } from "./ai-revision-target";

describe("copyOnlyRevisionTargetForFeedback", () => {
  it("routes clearly textual comments from both to copy", () => {
    expect(copyOnlyRevisionTargetForFeedback("both", "The top headline does not make sense")).toBe("copy");
    expect(copyOnlyRevisionTargetForFeedback("both", "The top part that says try our any large coffee doesn't make sense")).toBe("copy");
    expect(copyOnlyRevisionTargetForFeedback("both", "Make the wording shorter and warmer")).toBe("copy");
    expect(copyOnlyRevisionTargetForFeedback("both", "The top text reads weird. Make it a real ad from the whole deal.")).toBe("copy");
    expect(copyOnlyRevisionTargetForFeedback("both", "This copy feels generic and does not read right.")).toBe("copy");
    expect(copyOnlyRevisionTargetForFeedback("both", "Make it more inviting and less generic.")).toBe("copy");
  });

  it("routes subheadline, kicker, and supporting-line comments from both to copy", () => {
    expect(copyOnlyRevisionTargetForFeedback("both", "The subheadline got cut off and doesn't make sense")).toBe("copy");
    expect(copyOnlyRevisionTargetForFeedback("both", "Fix the sub headline")).toBe("copy");
    expect(copyOnlyRevisionTargetForFeedback("both", "The sub-headline is confusing")).toBe("copy");
    expect(copyOnlyRevisionTargetForFeedback("both", "Change the kicker")).toBe("copy");
    expect(copyOnlyRevisionTargetForFeedback("both", "The subline is incomplete")).toBe("copy");
    expect(copyOnlyRevisionTargetForFeedback("both", "Rewrite the supporting line")).toBe("copy");
    expect(copyOnlyRevisionTargetForFeedback("both", "The subtitle is cut off")).toBe("copy");
  });

  it("keeps both when feedback mentions image work too", () => {
    expect(copyOnlyRevisionTargetForFeedback("both", "Make the photo brighter and fix the headline")).toBe("both");
    expect(copyOnlyRevisionTargetForFeedback("both", "Try a different image angle")).toBe("both");
  });

  it("respects an explicit non-both target", () => {
    expect(copyOnlyRevisionTargetForFeedback("image", "Fix the headline")).toBe("image");
    expect(copyOnlyRevisionTargetForFeedback("copy", "Make the photo brighter")).toBe("copy");
  });
});
