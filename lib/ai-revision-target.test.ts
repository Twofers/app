import { describe, expect, it } from "vitest";

import { copyOnlyRevisionTargetForFeedback } from "./ai-revision-target";

describe("copyOnlyRevisionTargetForFeedback", () => {
  it("routes clearly textual comments from both to copy", () => {
    expect(copyOnlyRevisionTargetForFeedback("both", "The top headline does not make sense")).toBe("copy");
    expect(copyOnlyRevisionTargetForFeedback("both", "Make the wording shorter and warmer")).toBe("copy");
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
