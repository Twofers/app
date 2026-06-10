import { describe, expect, it } from "vitest";

import { buildAdCopyPrompt } from "./prompt.ts";

const basePrompt = buildAdCopyPrompt({
  itemHint: "Buy one iced vanilla latte and get a fresh blueberry muffin free",
  research: {
    item_name: "iced vanilla latte and blueberry muffin",
    description: "An iced espresso drink paired with a bakery-case muffin.",
    is_familiar: true,
  },
  businessName: "Cedar Street Cafe",
  businessContext: {
    category: "Coffee shop",
    location: "Downtown Grapevine",
    tone: "friendly and direct",
    description: "Neighborhood cafe serving espresso and fresh pastries.",
  },
  offerScheduleSummary: "Today 11:30 AM to 1:00 PM",
  quantityLimit: 20,
  redemptionLimit: "Claims close 15 minutes before the deal ends.",
  outputLanguage: "en",
});

describe("buildAdCopyPrompt", () => {
  it("includes anti-generic instructions and banned vague phrases", () => {
    expect(basePrompt.system).toContain("not a generic image caption");
    expect(basePrompt.system).toContain("Avoid generic marketing language");
    expect(basePrompt.system).toContain("Don't miss out");
    expect(basePrompt.system).toContain("Amazing deal");
    expect(basePrompt.system).toContain("Delicious treat");
    expect(basePrompt.system).toContain("Come enjoy our special offer");
  });

  it("includes good and bad examples", () => {
    expect(basePrompt.system).toContain("Bad:");
    expect(basePrompt.system).toContain("Enjoy a delicious treat today");
    expect(basePrompt.system).toContain("Midday latte break?");
    expect(basePrompt.system).toContain("Afternoon coffee run?");
  });

  it("passes product, BOGO, time window, and quantity facts", () => {
    expect(basePrompt.userText).toContain("iced vanilla latte");
    expect(basePrompt.userText).toContain("blueberry muffin free");
    expect(basePrompt.userText).toContain("Today 11:30 AM to 1:00 PM");
    expect(basePrompt.userText).toContain("20 available");
  });

  it("requires the structured output schema", () => {
    const schema = basePrompt.jsonSchema.schema;
    expect(schema.required).toEqual([
      "headline",
      "short_description",
      "push_notification",
      "terms_summary",
    ]);
    expect(Object.keys(schema.properties)).toEqual([
      "headline",
      "short_description",
      "push_notification",
      "terms_summary",
    ]);
  });

  it("tells the model not to invent missing facts", () => {
    expect(basePrompt.system).toContain("Do not invent missing products");
    expect(basePrompt.userText).toContain("write around it without inventing it");
    expect(basePrompt.userText).toContain("stay neutral instead of naming a latte");
  });
});
