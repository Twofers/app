import { describe, expect, it } from "vitest";

import { fitPosterTextToBox } from "../posterTextFit";

describe("poster text fitting", () => {
  it("preserves every character while balancing a long headline", () => {
    const value = "SERGEANT'S STRIPES FOR LESS";
    const fitted = fitPosterTextToBox({
      value,
      boxWidth: 936,
      baseFontSize: 84,
      baseLineHeight: 90,
      maxLines: 2,
    });

    expect(fitted.text.replace(/\n/g, " ")).toBe(value);
    expect(fitted.lineCount).toBe(2);
    expect(fitted.fontSize).toBeLessThanOrEqual(84);
  });

  it("shrinks single-line copy instead of clipping either edge", () => {
    const value = "A VERY LONG BUSINESS NAME THAT MUST STAY COMPLETE";
    const fitted = fitPosterTextToBox({
      value,
      boxWidth: 936,
      baseFontSize: 34,
      baseLineHeight: 42,
      maxLines: 1,
      letterSpacing: 3,
    });

    expect(fitted.text).toBe(value);
    expect(fitted.lineCount).toBe(1);
    expect(fitted.fontSize).toBeLessThan(34);
    expect(fitted.lineHeight).toBeLessThan(42);
  });

  it("keeps short and Korean copy at the requested size when it already fits", () => {
    const short = fitPosterTextToBox({
      value: "50% OFF",
      boxWidth: 848,
      baseFontSize: 56,
      baseLineHeight: 62,
    });
    const korean = fitPosterTextToBox({
      value: "50% 할인",
      boxWidth: 848,
      baseFontSize: 56,
      baseLineHeight: 62,
    });

    expect(short).toMatchObject({ text: "50% OFF", fontSize: 56, lineHeight: 62 });
    expect(korean).toMatchObject({ text: "50% 할인", fontSize: 56, lineHeight: 62 });
  });
});
