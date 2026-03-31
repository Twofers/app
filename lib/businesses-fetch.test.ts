import { describe, expect, it } from "vitest";

import { collectBusinessesPageByPage, type BusinessListRow } from "./businesses-fetch";

describe("collectBusinessesPageByPage", () => {
  it("collects all pages until the final short page", async () => {
    const rows: BusinessListRow[] = Array.from({ length: 450 }, (_, i) => ({
      id: `b-${i + 1}`,
      name: `Biz ${i + 1}`,
      location: null,
      latitude: null,
      longitude: null,
    }));
    const out = await collectBusinessesPageByPage(async ({ from, to }) => {
      return { data: rows.slice(from, to + 1), error: null };
    }, 200);
    expect(out.length).toBe(450);
    expect(out[0]?.id).toBe("b-1");
    expect(out[449]?.id).toBe("b-450");
  });
});
