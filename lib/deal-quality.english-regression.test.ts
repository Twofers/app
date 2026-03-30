import { describe, expect, it } from "vitest";
import {
  assessDealQuality,
  DEAL_QUALITY_BLOCK_MESSAGE,
  DEAL_QUALITY_CLARIFY_VALUE_MESSAGE,
  DEAL_QUALITY_MULTIPLE_PERCENT_MESSAGE,
} from "./deal-quality";

/**
 * English regression suite for publish-time deal quality.
 * Intentionally English-only strings — Spanish behavior is covered elsewhere / future suites.
 */
describe("deal quality — English regression", () => {
  it("blocks title shorter than 8 characters", () => {
    const r = assessDealQuality({ title: "short" });
    expect(r.blocked).toBe(true);
    expect(r.blockReason).toBe("TITLE_SHORT");
    expect(r.message).toContain("too short");
    expect(r.message).toContain(DEAL_QUALITY_BLOCK_MESSAGE);
  });

  it("accepts BOGO (English) as strong", () => {
    const r = assessDealQuality({
      title: "BOGO bagels today",
      description: "Buy one get one on all bagels until 3pm.",
    });
    expect(r.blocked).toBe(false);
    expect(r.blockReason).toBeNull();
    expect(r.tier).toBe("strong");
  });

  it("accepts buy one get one phrasing as strong", () => {
    const r = assessDealQuality({
      title: "Coffee buy one get one",
      description: "Morning rush special downtown.",
    });
    expect(r.blocked).toBe(false);
    expect(r.tier).toBe("strong");
  });

  it('accepts "get one free" BOGO shorthand (e.g. typo buy on / AI headline)', () => {
    const r = assessDealQuality({
      title: "Buy on cola get one free",
      description: "In-store today.",
    });
    expect(r.blocked).toBe(false);
    expect(r.tier).toBe("strong");
  });

  it("accepts two for one (English words) as strong", () => {
    const r = assessDealQuality({
      title: "Latte two for one special",
      description: "Valid at participating stores.",
    });
    expect(r.blocked).toBe(false);
    expect(r.tier).toBe("strong");
  });

  it("accepts buy 2 get 1 as strong", () => {
    const r = assessDealQuality({
      title: "Buy 2 get 1 free donuts",
      description: "Mix and match while supplies last.",
    });
    expect(r.blocked).toBe(false);
    expect(r.tier).toBe("strong");
  });

  it("accepts second item half off as strong", () => {
    const r = assessDealQuality({
      title: "Sandwiches second half off",
      description: "Second sandwich half off with purchase of first.",
    });
    expect(r.blocked).toBe(false);
    expect(r.tier).toBe("strong");
  });

  it("accepts meaningful free drink with purchase as strong", () => {
    const r = assessDealQuality({
      title: "Lunch combo special offer",
      description: "Free drink with purchase of any entree today.",
    });
    expect(r.blocked).toBe(false);
    expect(r.tier).toBe("strong");
  });

  it("blocks vague free item (not named drink/side/dessert/second)", () => {
    const r = assessDealQuality({
      title: "Free surprise with order",
      description: "Free item with purchase while supplies last.",
    });
    expect(r.blocked).toBe(true);
    expect(r.blockReason).toBe("CLARIFY_VALUE");
    expect(r.message).toBe(DEAL_QUALITY_CLARIFY_VALUE_MESSAGE);
  });

  it("blocks English percent under 40%", () => {
    const r = assessDealQuality({
      title: "Winter sale on jackets",
      description: "Everything 25% off this week only.",
    });
    expect(r.blocked).toBe(true);
    expect(r.blockReason).toBe("BELOW_THRESHOLD");
    expect(r.message).toBe(DEAL_QUALITY_BLOCK_MESSAGE);
  });

  it("accepts exactly 40% off (English) as acceptable", () => {
    const r = assessDealQuality({
      title: "Flash sale forty percent",
      description: "Entire store 40% off today only, exclusions apply.",
    });
    expect(r.blocked).toBe(false);
    expect(r.tier).toBe("acceptable");
  });

  it("accepts 45 percent written as digits + word as acceptable (no clearance in title)", () => {
    const r = assessDealQuality({
      title: "Warehouse markdown weekend sale",
      description: "Take an extra 45 percent off marked prices in store.",
    });
    expect(r.blocked).toBe(false);
    expect(r.tier).toBe("acceptable");
  });

  it("allows BOGO with extra percentage in fine print (structural primary)", () => {
    const r = assessDealQuality({
      title: "BOGO pizza slices",
      description: "Buy one get one. Rewards members earn 10% back on other purchases.",
    });
    expect(r.blocked).toBe(false);
    expect(r.tier).toBe("strong");
  });

  it("end of day plus 40% English is strong", () => {
    const r = assessDealQuality({
      title: "End of day bakery specials",
      description: "End of day — all pastries 40% off after 6pm.",
    });
    expect(r.blocked).toBe(false);
    expect(r.tier).toBe("strong");
  });

  it("clearance plus bundle English is strong", () => {
    const r = assessDealQuality({
      title: "Clearance rack lunch deals",
      description: "Clearance — $8 lunch combo slice and drink.",
    });
    expect(r.blocked).toBe(false);
    expect(r.tier).toBe("strong");
  });

  it("end of day without value signal is blocked", () => {
    const r = assessDealQuality({
      title: "Stop by for end of day",
      description: "End of day specials at our counter ask staff.",
    });
    expect(r.blocked).toBe(true);
    expect(r.blockReason).toBe("CLARIFY_VALUE");
    expect(r.message).toBe(DEAL_QUALITY_CLARIFY_VALUE_MESSAGE);
  });

  it('accepts "2 for $10" bundle English as acceptable', () => {
    const r = assessDealQuality({
      title: "Taco Tuesday two for ten",
      description: "Street tacos 2 for $10, dine in only.",
    });
    expect(r.blocked).toBe(false);
    expect(r.tier).toBe("acceptable");
  });

  it("does not treat spelled-out forty percent as numeric (strict MVP)", () => {
    const r = assessDealQuality({
      title: "Mystery markdown event",
      description: "Forty percent off entire store today only, no code needed.",
    });
    expect(r.blocked).toBe(true);
    expect(r.blockReason).toBe("CLARIFY_VALUE");
    expect(r.message).toBe(DEAL_QUALITY_CLARIFY_VALUE_MESSAGE);
  });

  it("blocks two competing headline percents without structural primary", () => {
    const r = assessDealQuality({
      title: "Shoes and shirts on sale now",
      description: "Shoes 30% off. Shirts 40% off. In store only.",
    });
    expect(r.blocked).toBe(true);
    expect(r.blockReason).toBe("MULTI_PERCENT");
    expect(r.message).toBe(DEAL_QUALITY_MULTIPLE_PERCENT_MESSAGE);
  });

  it("accepts Korean 1+1 style headline as strong", () => {
    const r = assessDealQuality({
      title: "카페 라떼 1+1 오늘만",
      description: "매장에서만 적용됩니다.",
    });
    expect(r.blocked).toBe(false);
    expect(r.tier).toBe("strong");
    expect(r.blockReason).toBeNull();
  });
});
