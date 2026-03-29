import { describe, expect, it } from "vitest";
import { splitSubheadlineForPromoAndBody } from "./menu-ad-copy";

describe("splitSubheadlineForPromoAndBody", () => {
  it("splits on first sentence boundary", () => {
    const s = splitSubheadlineForPromoAndBody("First part. Second part here.");
    expect(s.promoLine).toBe("First part.");
    expect(s.bodyCopy).toBe("Second part here.");
  });

  it("uses ! as sentence end", () => {
    const s = splitSubheadlineForPromoAndBody("Stop in! More detail after.");
    expect(s.promoLine).toBe("Stop in!");
    expect(s.bodyCopy).toBe("More detail after.");
  });

  it("single short line: no body", () => {
    const s = splitSubheadlineForPromoAndBody("Short line");
    expect(s.promoLine).toBe("Short line");
    expect(s.bodyCopy).toBe("");
  });

  it("empty input", () => {
    expect(splitSubheadlineForPromoAndBody("")).toEqual({ promoLine: "", bodyCopy: "" });
    expect(splitSubheadlineForPromoAndBody("   ")).toEqual({ promoLine: "", bodyCopy: "" });
  });

  it("long line without punctuation: teaser plus remainder, not duplicate full text", () => {
    const long = `${"x".repeat(53)}tail-here`;
    const s = splitSubheadlineForPromoAndBody(long);
    expect(s.promoLine.endsWith("…")).toBe(true);
    expect(s.bodyCopy).toBe("tail-here");
    expect(s.bodyCopy).not.toBe(long);
  });
});
