import { describe, expect, it } from "vitest";

import {
  buildSiteMenuPrompt,
  clampMenuPromptText,
  extractLogoCandidates,
  extractMenuLinks,
  htmlToMenuText,
  isPrivateOrReservedIp,
  MAX_MENU_PROMPT_CHARS,
  MAX_MENU_TEXT_CHARS,
  menuSchema,
  normalizeMenuItems,
  upgradeHttpToHttps,
  validateImportUrl,
} from "./site-import.ts";

const BASE = "https://example.com/";

describe("validateImportUrl", () => {
  it("accepts a plain https URL", () => {
    const r = validateImportUrl("https://example.com/menu");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url.hostname).toBe("example.com");
  });

  it("accepts an explicit :443 port", () => {
    expect(validateImportUrl("https://example.com:443/").ok).toBe(true);
  });

  it("rejects http", () => {
    const r = validateImportUrl("http://example.com/");
    expect(r).toEqual({ ok: false, code: "NOT_HTTPS" });
  });

  it("rejects other schemes", () => {
    expect(validateImportUrl("ftp://example.com/").ok).toBe(false);
    expect(validateImportUrl("file:///etc/passwd").ok).toBe(false);
    expect(validateImportUrl("javascript:alert(1)").ok).toBe(false);
  });

  it("rejects embedded credentials", () => {
    expect(validateImportUrl("https://user:pass@example.com/")).toEqual({
      ok: false,
      code: "HAS_CREDENTIALS",
    });
  });

  it("rejects a non-443 port", () => {
    expect(validateImportUrl("https://example.com:8080/")).toEqual({
      ok: false,
      code: "BAD_PORT",
    });
  });

  it("rejects IPv4 literal hosts", () => {
    expect(validateImportUrl("https://169.254.169.254/latest/meta-data")).toEqual({
      ok: false,
      code: "IP_LITERAL",
    });
  });

  it("rejects IPv6 literal hosts", () => {
    expect(validateImportUrl("https://[::1]/")).toEqual({ ok: false, code: "IP_LITERAL" });
  });

  it("rejects localhost / *.local / *.internal", () => {
    expect(validateImportUrl("https://localhost/").code).toBe("BLOCKED_HOST");
    expect(validateImportUrl("https://db.internal/").code).toBe("BLOCKED_HOST");
    expect(validateImportUrl("https://printer.local/").code).toBe("BLOCKED_HOST");
  });

  it("rejects over-long URLs", () => {
    const long = "https://example.com/" + "a".repeat(2100);
    expect(validateImportUrl(long)).toEqual({ ok: false, code: "TOO_LONG" });
  });

  it("rejects malformed input", () => {
    expect(validateImportUrl("not a url").code).toBe("MALFORMED");
    expect(validateImportUrl("").code).toBe("MALFORMED");
  });
});

describe("upgradeHttpToHttps", () => {
  it("upgrades a plain http URL, preserving host/path/query/hash", () => {
    expect(upgradeHttpToHttps("http://ascensiondallas.com/")).toBe("https://ascensiondallas.com/");
    expect(upgradeHttpToHttps("http://www.canerosso.com/menu?x=1#hours")).toBe(
      "https://www.canerosso.com/menu?x=1#hours",
    );
  });

  it("drops an explicit http-default :80 so the result uses the https default", () => {
    // The upgraded URL must pass validateImportUrl (empty/443 port only).
    const upgraded = upgradeHttpToHttps("http://rodeogoat.com:80/");
    expect(upgraded).toBe("https://rodeogoat.com/");
    expect(validateImportUrl(upgraded!).ok).toBe(true);
  });

  it("preserves a non-standard port so it still trips BAD_PORT downstream", () => {
    const upgraded = upgradeHttpToHttps("http://example.com:8080/");
    expect(upgraded).toBe("https://example.com:8080/");
    expect(validateImportUrl(upgraded!)).toEqual({ ok: false, code: "BAD_PORT" });
  });

  it("returns null for non-http input (already https, other schemes, empty)", () => {
    expect(upgradeHttpToHttps("https://example.com/")).toBeNull();
    expect(upgradeHttpToHttps("ftp://example.com/")).toBeNull();
    expect(upgradeHttpToHttps("")).toBeNull();
    expect(upgradeHttpToHttps("not a url")).toBeNull();
  });

  it("refuses to upgrade a credentialed URL (keeps the standard rejection)", () => {
    expect(upgradeHttpToHttps("http://user:pass@example.com/")).toBeNull();
  });

  it("keeps a private/reserved or blocked host blocked after upgrade", () => {
    // The upgrade only rewrites the scheme; the host defenses still apply.
    expect(validateImportUrl(upgradeHttpToHttps("http://169.254.169.254/")!)).toEqual({
      ok: false,
      code: "IP_LITERAL",
    });
    expect(validateImportUrl(upgradeHttpToHttps("http://localhost/")!).code).toBe("BLOCKED_HOST");
    expect(validateImportUrl(upgradeHttpToHttps("http://db.internal/")!).code).toBe("BLOCKED_HOST");
  });
});

describe("isPrivateOrReservedIp — IPv4 range boundaries", () => {
  const cases: Array<[string, boolean]> = [
    // 10.0.0.0/8
    ["9.255.255.255", false],
    ["10.0.0.0", true],
    ["10.255.255.255", true],
    ["11.0.0.0", false],
    // 172.16.0.0/12
    ["172.15.255.255", false],
    ["172.16.0.0", true],
    ["172.31.255.255", true],
    ["172.32.0.0", false],
    // 192.168.0.0/16
    ["192.167.255.255", false],
    ["192.168.0.0", true],
    ["192.168.255.255", true],
    ["192.169.0.0", false],
    // 127.0.0.0/8
    ["126.255.255.255", false],
    ["127.0.0.1", true],
    ["127.255.255.255", true],
    ["128.0.0.0", false],
    // 169.254.0.0/16 (link-local / metadata)
    ["169.253.255.255", false],
    ["169.254.0.0", true],
    ["169.254.169.254", true],
    ["169.255.0.0", false],
    // 0.0.0.0/8
    ["0.0.0.0", true],
    ["0.255.255.255", true],
    ["1.0.0.0", false],
    // 100.64.0.0/10 (CGNAT)
    ["100.63.255.255", false],
    ["100.64.0.0", true],
    ["100.127.255.255", true],
    ["100.128.0.0", false],
    // 192.0.0.0/24
    ["191.255.255.255", false],
    ["192.0.0.0", true],
    ["192.0.0.255", true],
    ["192.0.1.0", false],
    // 198.18.0.0/15 (benchmarking)
    ["198.17.255.255", false],
    ["198.18.0.0", true],
    ["198.19.255.255", true],
    ["198.20.0.0", false],
    // 224.0.0.0/3 (multicast + reserved)
    ["223.255.255.255", false],
    ["224.0.0.0", true],
    ["255.255.255.255", true],
    // a public address stays false
    ["8.8.8.8", false],
    ["93.184.216.34", false],
  ];
  for (const [ip, expected] of cases) {
    it(`${ip} → ${expected}`, () => {
      expect(isPrivateOrReservedIp(ip)).toBe(expected);
    });
  }
});

describe("isPrivateOrReservedIp — IPv6", () => {
  const cases: Array<[string, boolean]> = [
    ["::1", true], // loopback
    ["::", true], // unspecified
    ["fc00::", true], // unique-local low boundary
    ["fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", true], // unique-local high boundary
    ["fb00::", false], // just below fc00::/7
    ["fe00::", false], // between fc00::/7 and fe80::/10
    ["fe80::1", true], // link-local low
    ["febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff", true], // link-local high
    ["fec0::", false], // just above fe80::/10
    ["::ffff:127.0.0.1", true], // mapped IPv4 loopback → recurse
    ["::ffff:10.0.0.1", true], // mapped IPv4 private → recurse
    ["::ffff:8.8.8.8", false], // mapped IPv4 public → recurse
    ["2001:4860:4860::8888", false], // public
  ];
  for (const [ip, expected] of cases) {
    it(`${ip} → ${expected}`, () => {
      expect(isPrivateOrReservedIp(ip)).toBe(expected);
    });
  }

  it("returns false for non-IP strings", () => {
    expect(isPrivateOrReservedIp("example.com")).toBe(false);
    expect(isPrivateOrReservedIp("")).toBe(false);
  });
});

describe("extractLogoCandidates", () => {
  it("pulls JSON-LD, og:image and apple-touch-icon in priority order", () => {
    const html = `
      <html><head>
        <script type="application/ld+json">
          {"@context":"https://schema.org","@type":"Restaurant","name":"Taco Spot","logo":"https://example.com/ld-logo.png"}
        </script>
        <meta property="og:image" content="https://example.com/og.jpg">
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-180.png">
        <link rel="apple-touch-icon" sizes="120x120" href="/apple-120.png">
        <link rel="icon" href="/favicon.png">
      </head><body></body></html>`;
    const out = extractLogoCandidates(html, BASE);
    expect(out[0]).toEqual({ url: "https://example.com/ld-logo.png", source: "json_ld_logo" });
    expect(out[1]).toEqual({ url: "https://example.com/og.jpg", source: "og_image" });
    // 180 before 120 (largest sizes first)
    expect(out[2]).toEqual({ url: "https://example.com/apple-180.png", source: "apple_touch_icon" });
    expect(out[3]).toEqual({ url: "https://example.com/apple-120.png", source: "apple_touch_icon" });
    expect(out[4]).toEqual({ url: "https://example.com/favicon.png", source: "link_icon" });
  });

  it("excludes favicon.ico and svg icons (RN can't render them)", () => {
    const html = `<head>
      <link rel="icon" href="/favicon.ico">
      <link rel="icon" type="image/svg+xml" href="/logo.svg">
    </head>`;
    expect(extractLogoCandidates(html, BASE)).toEqual([]);
  });

  it("resolves relative URLs against the base", () => {
    const html = `<meta property="og:image" content="images/logo.png">`;
    const out = extractLogoCandidates(html, "https://shop.example.com/about");
    expect(out[0].url).toBe("https://shop.example.com/images/logo.png");
  });

  it("drops http: (non-https) logo links", () => {
    const html = `<meta property="og:image" content="http://example.com/insecure.png">`;
    expect(extractLogoCandidates(html, BASE)).toEqual([]);
  });

  it("finds a header <img> whose class matches logo", () => {
    const html = `<header><a href="/"><img class="site-logo" src="/brand.png" alt="Home"></a></header>`;
    const out = extractLogoCandidates(html, BASE);
    expect(out).toContainEqual({ url: "https://example.com/brand.png", source: "header_img" });
  });

  it("dedupes and caps at 6", () => {
    const links = Array.from({ length: 10 }, (_, i) => `<link rel="icon" href="/i${i}.png">`).join("");
    const out = extractLogoCandidates(`<head>${links}</head>`, BASE);
    expect(out.length).toBe(6);
  });
});

describe("extractMenuLinks", () => {
  it.each([
    ["/menu", "Food", "https://example.com/menu"], // href match
    ["/our-food", "Our Menu", "https://example.com/our-food"], // link-text match
    ["/carta", "Carta", "https://example.com/carta"], // Spanish
    ["/ko", "메뉴", "https://example.com/ko"], // Korean
  ])("matches the menu pattern in href/text (%s / %s)", (href, text, expected) => {
    const out = extractMenuLinks(`<a href="${href}">${text}</a>`, BASE);
    expect(out.map((l) => l.url)).toContain(expected);
  });

  it("ranks pages before PDFs, excludes non-menu PDFs, and caps at 3", () => {
    const html = `
      <a href="/menu">Menu</a>
      <a href="/lunch">Lunch menu</a>
      <a href="/downloads/menu.pdf">Download menu</a>
      <a href="/catering.pdf">Catering info</a>
    `;
    const out = extractMenuLinks(html, BASE);
    const urls = out.map((l) => l.url);
    // A bare catering PDF (no menu word) must not win.
    expect(urls).not.toContain("https://example.com/catering.pdf");
    // Cap at 3, pages ahead of pdfs.
    expect(out.length).toBeLessThanOrEqual(3);
    expect(out[0].kind).toBe("page");
    expect(out[out.length - 1].url).toBe("https://example.com/downloads/menu.pdf");
  });

  it("drops cross-host menu links (same-host only in v1)", () => {
    const html = `<a href="https://order.toasttab.com/menu">Order online (menu)</a>`;
    expect(extractMenuLinks(html, BASE)).toEqual([]);
  });

  it("keeps a same-host menu PDF", () => {
    const html = `<a href="/menu.pdf">Our menu (PDF)</a>`;
    expect(extractMenuLinks(html, BASE)).toEqual([
      { url: "https://example.com/menu.pdf", kind: "pdf" },
    ]);
  });
});

describe("htmlToMenuText", () => {
  it("strips scripts/styles/tags and decodes entities", () => {
    const html = `
      <style>.x{color:red}</style>
      <script>var a = 1 < 2;</script>
      <h1>Espresso &amp; Milk</h1>
      <p>Latte &#8212; $5</p>
      <!-- hidden -->`;
    const text = htmlToMenuText(html);
    expect(text).toContain("Espresso & Milk");
    expect(text).toContain("Latte");
    expect(text).toContain("$5");
    expect(text).not.toContain("<");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("var a");
  });

  it("caps at MAX_MENU_TEXT_CHARS", () => {
    const html = "<p>" + "word ".repeat(10000) + "</p>";
    expect(htmlToMenuText(html).length).toBeLessThanOrEqual(MAX_MENU_TEXT_CHARS);
  });
});

describe("clampMenuPromptText", () => {
  it("passes short text through unchanged", () => {
    expect(clampMenuPromptText("Latte $5")).toBe("Latte $5");
  });

  it("caps at MAX_MENU_PROMPT_CHARS (tighter than the extraction cap)", () => {
    const long = "x".repeat(MAX_MENU_TEXT_CHARS);
    expect(clampMenuPromptText(long).length).toBe(MAX_MENU_PROMPT_CHARS);
    expect(MAX_MENU_PROMPT_CHARS).toBeLessThan(MAX_MENU_TEXT_CHARS);
  });

  it("returns empty string for non-string input", () => {
    expect(clampMenuPromptText(undefined as unknown as string)).toBe("");
  });
});

describe("buildSiteMenuPrompt", () => {
  it("uses the category and forbids invention (regression snapshot)", () => {
    const prompt = buildSiteMenuPrompt("coffee shop");
    expect(prompt).toBe(
      [
        "You extract menu line items from the website text of a coffee shop on a local deals app.",
        "",
        "Rules:",
        "- Only include items that literally appear in the website text. Never invent dishes, prices, or items.",
        "- Prefer an empty items list over guessing. If the text does not look like a menu, return no items.",
        "- readable = true for every item you emit (website text is legible by definition; the field is kept for schema parity).",
        "- name = the short item name only (e.g. 'Recon Roast'), never a description. If a line pairs a name with descriptive text (in parentheses, after a dash, or on the next line), put only the name in name.",
        "- description = that item's descriptive text as written (e.g. 'Roaster fresh coffee with a shot of espresso'), or empty string if none. Never repeat the name inside description.",
        "- category = the menu section heading if present, else empty string.",
        "- price_text = the price exactly as printed (e.g. $4.50) or empty if no price is shown for that item.",
        "- size_options = the sizes/variants printed for that item (e.g. Small, Large, 12 oz, 16 oz). Keep labels exactly as printed. Use [] when none.",
        "- If prices vary by size, keep the full printed size/price text in price_text and also list the sizes in size_options.",
        "- If the text clearly is not a menu (e.g. an About or Contact page), set low_legibility = true and keep items minimal.",
        "- menu_notes: a brief note for the owner (e.g. 'prices not listed') or empty string.",
        "- Extract EVERY distinct item you can read — the owner will pick which ones to use for deals.",
      ].join("\n"),
    );
  });

  it("falls back to 'local business' for an empty category", () => {
    expect(buildSiteMenuPrompt("")).toContain("a local business on a local deals app");
  });
});

describe("normalizeMenuItems + menuSchema", () => {
  it("drops unreadable/empty rows and trims fields", () => {
    const out = normalizeMenuItems({
      items: [
        { name: "  Latte  ", description: "", category: " Coffee ", price_text: " $5 ", size_options: [" 12oz ", ""], readable: true },
        { name: "Ghost", description: "", category: "", price_text: "", size_options: [], readable: false },
        { name: "   ", description: "", category: "", price_text: "", size_options: [], readable: true },
      ],
      low_legibility: false,
      menu_notes: "",
    });
    expect(out).toEqual([
      { name: "Latte", description: undefined, category: "Coffee", price_text: "$5", size_options: ["12oz"], readable: true },
    ]);
  });

  it("carries a model-provided description through, trimmed", () => {
    const out = normalizeMenuItems({
      items: [
        {
          name: "Recon Roast",
          description: " Roaster fresh coffee with a shot of espresso ",
          category: "Coffee",
          price_text: "$5",
          size_options: [],
          readable: true,
        },
      ],
      low_legibility: false,
      menu_notes: "",
    });
    expect(out[0].name).toBe("Recon Roast");
    expect(out[0].description).toBe("Roaster fresh coffee with a shot of espresso");
  });

  it("splits a trailing parenthetical description out of the name (legacy model output)", () => {
    const out = normalizeMenuItems({
      items: [
        {
          name: "the recon roast ( Roaster fresh coffee with a shot of espresso)",
          description: "",
          category: "",
          price_text: "",
          size_options: [],
          readable: true,
        },
        {
          name: "Wings (12 pc)",
          description: "",
          category: "",
          price_text: "",
          size_options: [],
          readable: true,
        },
      ],
      low_legibility: false,
      menu_notes: "",
    });
    expect(out[0].name).toBe("the recon roast");
    expect(out[0].description).toBe("Roaster fresh coffee with a shot of espresso");
    // Short qualifiers stay part of the name.
    expect(out[1].name).toBe("Wings (12 pc)");
    expect(out[1].description).toBeUndefined();
  });

  it("prefers the model description over the split remnant when both exist", () => {
    const out = normalizeMenuItems({
      items: [
        {
          name: "Recon Roast (roaster fresh coffee with a shot of espresso)",
          description: "Roaster fresh coffee with espresso.",
          category: "",
          price_text: "",
          size_options: [],
          readable: true,
        },
      ],
      low_legibility: false,
      menu_notes: "",
    });
    expect(out[0].name).toBe("Recon Roast");
    expect(out[0].description).toBe("Roaster fresh coffee with espresso.");
  });

  it("caps size_options at 12", () => {
    const sizes = Array.from({ length: 20 }, (_, i) => `s${i}`);
    const out = normalizeMenuItems({
      items: [{ name: "X", description: "", category: "", price_text: "", size_options: sizes, readable: true }],
      low_legibility: false,
      menu_notes: "",
    });
    expect(out[0].size_options.length).toBe(12);
  });

  it("keeps the schema shape identical to the menu scanner", () => {
    expect(menuSchema.name).toBe("menu_extraction");
    expect(menuSchema.schema.required).toEqual(["items", "low_legibility", "menu_notes"]);
    expect(menuSchema.schema.properties.items.items.required).toEqual([
      "name",
      "description",
      "category",
      "price_text",
      "size_options",
      "readable",
    ]);
  });
});
