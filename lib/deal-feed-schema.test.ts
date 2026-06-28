import { describe, expect, it } from "vitest";
import {
  DEAL_FEED_BASE_SELECT,
  DEAL_FEED_SELECT,
  DEAL_STRUCTURED_DISPLAY_COLUMNS,
  isMissingStructuredDisplayColumnError,
} from "./deal-feed-schema";

describe("deal feed select schema", () => {
  it("keeps structured display fields in the enriched consumer select", () => {
    expect(DEAL_FEED_SELECT).toContain(DEAL_FEED_BASE_SELECT);
    expect(DEAL_FEED_SELECT).toContain(DEAL_STRUCTURED_DISPLAY_COLUMNS);
    expect(DEAL_FEED_SELECT).toContain("required_item_description");
    expect(DEAL_FEED_SELECT).toContain("free_item_description");
    expect(DEAL_FEED_SELECT).toContain("required_purchase_quantity");
  });

  it("detects staged schema misses so callers can fall back to the base select", () => {
    expect(
      isMissingStructuredDisplayColumnError({
        code: "PGRST204",
        message: "Could not find the required_purchase_quantity column in the schema cache",
      }),
    ).toBe(true);

    expect(
      isMissingStructuredDisplayColumnError({
        code: "42501",
        message: "permission denied for table deals",
      }),
    ).toBe(false);
  });
});
