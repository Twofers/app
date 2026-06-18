import { describe, expect, it } from "vitest";

import { buildReuseHistoryRows } from "./reuse-history";

describe("buildReuseHistoryRows", () => {
  it("sorts by most recently used and collapses duplicate offers", () => {
    const rows = buildReuseHistoryRows([
      {
        id: "old",
        title: "BOGO latte",
        created_at: "2026-06-10T10:00:00Z",
        price: 4.25,
        deal_type: "BUY_ONE_GET_ONE_FREE",
        required_item_description: "latte",
        free_item_description: "latte",
      },
      {
        id: "latest",
        title: "BOGO latte",
        created_at: "2026-06-12T10:00:00Z",
        price: 4.25,
        deal_type: "BUY_ONE_GET_ONE_FREE",
        required_item_description: "latte",
        free_item_description: "latte",
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.deal.id).toBe("latest");
    expect(rows[0]?.title).toBe("Buy one latte and get one free");
    expect(rows[0]?.regularPrice).toBe("$4.25");
  });

  it("keeps distinct offers even when they share timing", () => {
    const rows = buildReuseHistoryRows([
      {
        id: "coffee",
        title: "40% off coffee",
        created_at: "2026-06-12T10:00:00Z",
        deal_type: "PERCENT_OFF_SINGLE_ITEM",
        discount_percent: 40,
        item_description: "coffee",
      },
      {
        id: "tea",
        title: "40% off tea",
        created_at: "2026-06-12T10:00:00Z",
        deal_type: "PERCENT_OFF_SINGLE_ITEM",
        discount_percent: 40,
        item_description: "tea",
      },
    ]);

    expect(rows.map((row) => row.deal.id)).toEqual(["coffee", "tea"]);
  });
});
