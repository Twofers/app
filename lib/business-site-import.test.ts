import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  devWarn: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("./supabase", () => ({
  supabase: {
    functions: { invoke: mocks.invoke },
  },
}));

vi.mock("./dev-log", () => ({
  devWarn: mocks.devWarn,
}));

import { importBusinessWebsite, SiteImportError } from "./business-site-import";

const happyPayload = {
  ok: true,
  logo_candidates: [
    { data_uri: "data:image/png;base64,AAAA", source: "og_image", content_type: "image/png", bytes: 4 },
    { data_uri: "http://not-a-data-uri", source: "og_image", content_type: "image/png", bytes: 0 },
  ],
  menu: {
    items: [
      { name: "  Latte ", category: " Coffee ", price_text: " $5 ", size_options: ["12oz", ""], readable: true },
      { name: "", category: "", price_text: "", size_options: [], readable: true },
    ],
    low_legibility: false,
    menu_notes: "",
  },
  menu_page_url: "https://example.com/menu",
  menu_pdf_url: null,
  site_title: "Example Cafe",
  warnings: [],
};

describe("importBusinessWebsite", () => {
  beforeEach(() => {
    mocks.devWarn.mockReset();
    mocks.invoke.mockReset();
  });

  it("parses a happy-path payload and drops malformed rows", async () => {
    mocks.invoke.mockResolvedValue({ data: happyPayload, error: null });

    const result = await importBusinessWebsite({ website_url: "https://example.com" });

    expect(mocks.invoke).toHaveBeenCalledWith(
      "import-business-website",
      expect.objectContaining({ body: { website_url: "https://example.com" } }),
    );
    // Non-data-uri logo dropped.
    expect(result.logo_candidates).toEqual([
      { data_uri: "data:image/png;base64,AAAA", source: "og_image", content_type: "image/png", bytes: 4 },
    ]);
    // Empty-name menu row dropped; fields trimmed.
    expect(result.menu?.items).toEqual([
      { name: "Latte", category: "Coffee", price_text: "$5", size_options: ["12oz"], readable: true },
    ]);
    expect(result.menu_page_url).toBe("https://example.com/menu");
    expect(result.site_title).toBe("Example Cafe");
  });

  it("splits legacy 'Name ( long description )' items and carries description", async () => {
    mocks.invoke.mockResolvedValue({
      data: {
        ...happyPayload,
        menu: {
          items: [
            // Old function deploys pack the blurb into the name.
            {
              name: "the recon roast ( Roaster fresh coffee with a shot of espresso)",
              category: "",
              price_text: "",
              size_options: [],
              readable: true,
            },
            // New deploys return a separate description field.
            {
              name: "the sargents stripes",
              description: "select orgin estate grown coffee",
              category: "",
              price_text: "",
              size_options: [],
              readable: true,
            },
          ],
          low_legibility: false,
          menu_notes: "",
        },
      },
      error: null,
    });

    const result = await importBusinessWebsite({ website_url: "https://example.com" });
    expect(result.menu?.items).toEqual([
      {
        name: "the recon roast",
        description: "Roaster fresh coffee with a shot of espresso",
        category: undefined,
        price_text: undefined,
        size_options: [],
        readable: true,
      },
      {
        name: "the sargents stripes",
        description: "select orgin estate grown coffee",
        category: undefined,
        price_text: undefined,
        size_options: [],
        readable: true,
      },
    ]);
  });

  it("passes business_id through only when provided", async () => {
    mocks.invoke.mockResolvedValue({ data: happyPayload, error: null });

    await importBusinessWebsite({ website_url: "https://example.com", business_id: "biz-1" });
    expect(mocks.invoke).toHaveBeenCalledWith(
      "import-business-website",
      expect.objectContaining({ body: { website_url: "https://example.com", business_id: "biz-1" } }),
    );
  });

  it("returns menu: null with warnings (soft not-found)", async () => {
    mocks.invoke.mockResolvedValue({
      data: { ok: true, logo_candidates: [], menu: null, menu_page_url: null, menu_pdf_url: null, site_title: "", warnings: ["MENU_NOT_FOUND"] },
      error: null,
    });

    const result = await importBusinessWebsite({ website_url: "https://example.com" });
    expect(result.menu).toBeNull();
    expect(result.warnings).toEqual(["MENU_NOT_FOUND"]);
    expect(result.logo_candidates).toEqual([]);
  });

  it.each([
    ["RATE_LIMITED", { message: JSON.stringify({ error: "Slow down", error_code: "RATE_LIMITED" }) }],
    ["BLOCKED_URL", { context: { body: { error: "blocked", error_code: "BLOCKED_URL" } } }],
    ["FETCH_FAILED", { message: JSON.stringify({ error: "nope", error_code: "FETCH_FAILED" }) }],
    ["INVALID_URL", { context: { body: { error: "bad", error_code: "INVALID_URL" } } }],
  ])("maps error_code %s from the invoke error", async (code, error) => {
    mocks.invoke.mockResolvedValue({ data: null, error });

    await expect(importBusinessWebsite({ website_url: "https://x.com" })).rejects.toMatchObject({
      code,
    });
    expect(mocks.devWarn).toHaveBeenCalled();
  });

  it("throws SiteImportError with SERVER fallback on a non-JSON invoke error", async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: { message: "network down" } });

    const err = await importBusinessWebsite({ website_url: "https://x.com" }).catch((e) => e);
    expect(err).toBeInstanceOf(SiteImportError);
    expect((err as SiteImportError).code).toBe("SERVER");
  });

  it("throws when the 200 body itself carries an error field", async () => {
    mocks.invoke.mockResolvedValue({
      data: { error: "Server error.", error_code: "SERVER" },
      error: null,
    });

    await expect(importBusinessWebsite({ website_url: "https://x.com" })).rejects.toBeInstanceOf(
      SiteImportError,
    );
  });

  it("never throws on a malformed success payload", async () => {
    mocks.invoke.mockResolvedValue({ data: { ok: true, logo_candidates: "nope", menu: 42 }, error: null });

    const result = await importBusinessWebsite({ website_url: "https://example.com" });
    expect(result.logo_candidates).toEqual([]);
    expect(result.menu).toBeNull();
    expect(result.warnings).toEqual([]);
  });
});
