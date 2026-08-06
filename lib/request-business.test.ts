import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

const invoke = vi.fn();

vi.mock("@/lib/supabase", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
vi.mock("@/lib/functions", () => ({
  EDGE_FUNCTION_TIMEOUT_MS: 30_000,
  parseFunctionError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const { searchLocalBusinesses, requestBusinessOnTwofer } = await import("./request-business");

beforeEach(() => {
  invoke.mockReset();
});

describe("searchLocalBusinesses", () => {
  it("returns [] without calling the function for a blank query", async () => {
    const out = await searchLocalBusinesses("   ");
    expect(out).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("invokes public-local-businesses with the trimmed query and filters malformed rows", async () => {
    invoke.mockResolvedValue({
      data: {
        ok: true,
        businesses: [
          { id: "b1", record_type: "business", display_name: "Corner Cafe", category: "cafe", city: "Irving", coarse_location: "Irving, TX", public_label_state: "On Twofer" },
          { id: "p1", record_type: "prospect", display_name: "Sunrise Bakery" },
          { id: "bad", record_type: "unknown", display_name: "Nope" },
          { display_name: "Missing id" },
          "not an object",
        ],
      },
      error: null,
    });

    const out = await searchLocalBusinesses("  corner  ");

    expect(invoke).toHaveBeenCalledWith(
      "public-local-businesses",
      expect.objectContaining({ body: { query: "corner", city: null, limit: 8 } }),
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: "b1", record_type: "business" });
    expect(out[1]).toMatchObject({ id: "p1", record_type: "prospect" });
  });

  it("surfaces a server error body", async () => {
    invoke.mockResolvedValue({ data: { error: "Could not load local businesses." }, error: null });
    await expect(searchLocalBusinesses("test")).rejects.toThrow("Could not load local businesses.");
  });
});

describe("requestBusinessOnTwofer", () => {
  it("sends business_id and signal_type=request for a business target", async () => {
    invoke.mockResolvedValue({ data: { ok: true, saved: true, deduped: false }, error: null });

    const out = await requestBusinessOnTwofer({ businessId: "biz-1" }, { sourceSurface: "app_shops_footer" });

    expect(invoke).toHaveBeenCalledWith(
      "request-business-on-twofer",
      expect.objectContaining({
        body: { signal_type: "request", source_surface: "app_shops_footer", business_id: "biz-1" },
      }),
    );
    expect(out).toEqual({ ok: true, saved: true, deduped: false });
  });

  it("sends prospect_id for a prospect target", async () => {
    invoke.mockResolvedValue({ data: { ok: true, saved: true, deduped: false }, error: null });

    await requestBusinessOnTwofer({ prospectId: "prospect-1" });

    expect(invoke).toHaveBeenCalledWith(
      "request-business-on-twofer",
      expect.objectContaining({
        body: { signal_type: "request", source_surface: "app_consumer_home", prospect_id: "prospect-1" },
      }),
    );
  });

  it("reports deduped:true (already requested today) as a success, not an error", async () => {
    invoke.mockResolvedValue({ data: { ok: true, saved: false, deduped: true }, error: null });
    const out = await requestBusinessOnTwofer({ businessId: "biz-1" });
    expect(out).toEqual({ ok: true, saved: false, deduped: true });
  });

  it("throws the sign-in message when the user isn't authenticated", async () => {
    invoke.mockResolvedValue({ data: { error: "Sign in to request this business." }, error: null });
    await expect(requestBusinessOnTwofer({ businessId: "biz-1" })).rejects.toThrow(
      "Sign in to request this business.",
    );
  });

  it("surfaces a thrown invoke error via parseFunctionError", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("Could not save this request.") });
    await expect(requestBusinessOnTwofer({ businessId: "biz-1" })).rejects.toThrow(
      "Could not save this request.",
    );
  });
});
