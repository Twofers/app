import { describe, expect, it } from "vitest";

import { dealCountdownLabel } from "./deal-countdown";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("dealCountdownLabel", () => {
  it("returns null for an ended deal", () => {
    expect(dealCountdownLabel(0)).toBeNull();
    expect(dealCountdownLabel(-1)).toBeNull();
    expect(dealCountdownLabel(Number.NaN)).toBeNull();
  });

  it("never shows 0m while the deal is still live", () => {
    expect(dealCountdownLabel(1_000)).toEqual({ key: "consumerHome.timeLeftM", params: { m: 1 } });
  });

  it("uses minutes under an hour", () => {
    expect(dealCountdownLabel(45 * MIN)).toEqual({ key: "consumerHome.timeLeftM", params: { m: 45 } });
  });

  it("uses hours and minutes under a day", () => {
    expect(dealCountdownLabel(3 * HOUR + 20 * MIN)).toEqual({
      key: "consumerHome.timeLeftHM",
      params: { h: 3, m: 20 },
    });
  });

  it("switches to days at exactly 24h", () => {
    expect(dealCountdownLabel(24 * HOUR)).toEqual({ key: "consumerHome.timeLeftD", params: { d: 1 } });
    expect(dealCountdownLabel(23 * HOUR + 59 * MIN)).toEqual({
      key: "consumerHome.timeLeftHM",
      params: { h: 23, m: 59 },
    });
  });

  it("includes leftover hours alongside days", () => {
    expect(dealCountdownLabel(2 * DAY + 5 * HOUR)).toEqual({
      key: "consumerHome.timeLeftDH",
      params: { d: 2, h: 5 },
    });
  });

  it("omits hours when the remainder is a whole number of days", () => {
    expect(dealCountdownLabel(3 * DAY)).toEqual({ key: "consumerHome.timeLeftD", params: { d: 3 } });
  });

  // The regression this exists for: the Grapevine demo deals rendered
  // "1022h 33m left" on the consumer feed instead of a day count.
  it("renders a six-week deal in days, not four-figure hours", () => {
    const label = dealCountdownLabel(1022 * HOUR + 33 * MIN);
    expect(label).toEqual({ key: "consumerHome.timeLeftDH", params: { d: 42, h: 14 } });
  });
});
