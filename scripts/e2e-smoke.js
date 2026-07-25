#!/usr/bin/env node
/**
 * Homepage end-to-end smoke test (en / es / ko).
 *
 * Uses the already-installed `playwright` library (NOT @playwright/test, which
 * would be a new dependency) plus a small static server mirroring the routing
 * in check-website-ui-crawl.js. Run with `npm run test:e2e`.
 *
 * By default it serves website/ locally and tests against that. Set
 * E2E_BASE_URL (e.g. https://www.twoferapp.com) to test a deployed origin
 * instead; the local server is then skipped.
 *
 * For each of en, es, ko it loads the homepage, switches to that language, and
 * asserts:
 *   1. No visible data-i18n element still renders an un-swapped English string,
 *      and localization actually applied (a meaningful number of strings changed
 *      away from the English baseline).
 *   2. The App Store link resolves to id6765769303 and the Play link to
 *      com.unvmex2.twoforone.
 *   3. Every "Request Business Access" button points at /business/start-trial,
 *      and that route returns 200.
 *   4. /support, /privacy and /terms each return 200.
 *
 * Exits non-zero and prints every failure if anything fails.
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, request } = require("playwright");

const SITE_ROOT = path.resolve(__dirname, "..", "website");
const LOCALES = ["en", "es", "ko"];
const MIN_TRANSLATED = 25; // es/ko: at least this many visible strings must change from English.

const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
]);

// Mirrors routeToFile() in check-website-ui-crawl.js so local routing matches
// how the site actually resolves folder-index routes.
function routeToFile(pathname) {
  if (pathname === "/") return path.join(SITE_ROOT, "index.html");
  if (pathname.startsWith("/s/") && !path.extname(pathname)) return path.join(SITE_ROOT, "s", "index.html");
  if (path.extname(pathname)) return path.join(SITE_ROOT, pathname);
  return path.join(SITE_ROOT, pathname, "index.html");
}

function safePathname(url) {
  return decodeURIComponent(new URL(url, "http://127.0.0.1").pathname);
}

function withinSite(filePath) {
  const resolved = path.resolve(filePath);
  return resolved === SITE_ROOT || resolved.startsWith(`${SITE_ROOT}${path.sep}`);
}

function createServer() {
  return http.createServer((req, res) => {
    try {
      const filePath = routeToFile(safePathname(req.url));
      if (!withinSite(filePath) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        fs.createReadStream(path.join(SITE_ROOT, "404.html")).pipe(res);
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME.get(ext) || "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(String(error?.stack || error));
    }
  });
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

// Collect, in the page, the rendered vs. intended text for every data-i18n and
// data-i18n-html element, plus whether it is visible. `intended` is derived from
// TwoferI18n.t(key) for the active locale with any markup stripped, so it
// compares apples to apples with textContent.
function collectI18nScript() {
  return () => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const strip = (html) => {
      const d = document.createElement("div");
      d.innerHTML = html;
      return norm(d.textContent);
    };
    const isVisible = (el) => {
      if (typeof el.checkVisibility === "function") {
        return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      }
      return !!(el.offsetParent || el.getClientRects().length);
    };
    const t = (key) => (window.TwoferI18n ? window.TwoferI18n.t(key) : "");
    const out = [];
    document.querySelectorAll("[data-i18n], [data-i18n-html]").forEach((el) => {
      const key = el.getAttribute("data-i18n") || el.getAttribute("data-i18n-html");
      if (!key) return;
      out.push({
        key,
        actual: norm(el.textContent),
        intended: strip(t(key)),
        hasIntended: !!t(key),
        visible: isVisible(el),
      });
    });
    return out;
  };
}

function collectStoreAndTrialScript() {
  return () => {
    const links = (sel) =>
      [...document.querySelectorAll(sel)].map((a) => ({
        href: a.getAttribute("href") || "",
        visible:
          typeof a.checkVisibility === "function"
            ? a.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
            : !!(a.offsetParent || a.getClientRects().length),
      }));
    return {
      ios: links('[data-store-cta="ios"]'),
      android: links('[data-store-cta="android"]'),
      trial: [...document.querySelectorAll('a[data-i18n="nav.businessTrial"], a[href="/business/start-trial"]')].map(
        (a) => {
          const u = new URL(a.getAttribute("href") || "", location.origin);
          return u.pathname;
        }
      ),
    };
  };
}

async function run() {
  const failures = [];
  const note = (msg) => console.log(msg);
  const fail = (locale, req, detail) => {
    failures.push({ locale, req, detail });
    console.log(`  ✗ [${locale}] ${req}: ${detail}`);
  };
  const pass = (locale, req, detail) => console.log(`  ✓ [${locale}] ${req}: ${detail}`);

  const envBase = process.env.E2E_BASE_URL && process.env.E2E_BASE_URL.replace(/\/$/, "");
  let server = null;
  let base = envBase;
  if (!base) {
    server = createServer();
    const port = await listen(server);
    base = `http://127.0.0.1:${port}`;
  }
  note(`Base URL: ${base}${server ? " (local static server)" : " (external)"}`);

  const browser = await chromium.launch();
  const api = await request.newContext({ baseURL: base, ignoreHTTPSErrors: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  let englishBaseline = null;

  try {
    for (const locale of LOCALES) {
      note(`\n== ${locale.toUpperCase()} ==`);

      await page.goto(`${base}/`, { waitUntil: "load" });
      await page.waitForFunction(() => window.TwoferI18n && typeof window.TwoferI18n.applyLocale === "function", {
        timeout: 15000,
      });
      // Wait for store-links.js to wire the store CTAs.
      await page
        .waitForFunction(
          () => {
            const a = document.querySelector('[data-store-cta="ios"]');
            return a && (a.getAttribute("href") || "").includes("id6765769303");
          },
          { timeout: 15000 }
        )
        .catch(() => {});

      // Switch language and wait for the swap to complete.
      await page.click(`[data-language-option="${locale}"]`);
      await page.waitForFunction((l) => document.documentElement.lang === l, locale, { timeout: 15000 });

      // --- Requirement 1: no untranslated English string on screen -----------
      const rows = await page.evaluate(collectI18nScript());
      const visible = rows.filter((r) => r.visible && r.hasIntended);
      const mismatches = visible.filter((r) => r.actual !== r.intended);

      if (locale === "en") {
        englishBaseline = new Map(visible.map((r) => [r.key, r.actual]));
      }

      if (mismatches.length) {
        for (const m of mismatches.slice(0, 12)) {
          fail(locale, "req1-untranslated", `"${m.key}" shows "${m.actual}" (expected "${m.intended}")`);
        }
        if (mismatches.length > 12) fail(locale, "req1-untranslated", `...and ${mismatches.length - 12} more`);
      } else if (locale !== "en") {
        const changed = visible.filter(
          (r) => englishBaseline && englishBaseline.has(r.key) && englishBaseline.get(r.key) !== r.actual
        ).length;
        if (changed < MIN_TRANSLATED) {
          fail(
            locale,
            "req1-untranslated",
            `only ${changed} visible strings changed from English (expected >= ${MIN_TRANSLATED}) - localization may not have applied`
          );
        } else {
          pass(locale, "req1-untranslated", `${visible.length} visible strings match locale, ${changed} changed from English`);
        }
      } else {
        pass(locale, "req1-untranslated", `${visible.length} visible strings render their intended text`);
      }

      // --- Requirements 2 & 3: store + trial links ---------------------------
      const dom = await page.evaluate(collectStoreAndTrialScript());

      const iosVisible = dom.ios.filter((l) => l.visible);
      const androidVisible = dom.android.filter((l) => l.visible);
      const iosOk = (iosVisible.length ? iosVisible : dom.ios).some((l) => l.href.includes("id6765769303"));
      const androidOk = (androidVisible.length ? androidVisible : dom.android).some((l) =>
        l.href.includes("com.unvmex2.twoforone")
      );
      if (iosOk) pass(locale, "req2-appstore", "App Store link resolves to id6765769303");
      else fail(locale, "req2-appstore", `no iOS CTA href contains id6765769303 (${dom.ios.map((l) => l.href).join(", ") || "none"})`);
      if (androidOk) pass(locale, "req2-play", "Play link resolves to com.unvmex2.twoforone");
      else
        fail(
          locale,
          "req2-play",
          `no Android CTA href contains com.unvmex2.twoforone (${dom.android.map((l) => l.href).join(", ") || "none"})`
        );

      if (!dom.trial.length) {
        fail(locale, "req3-trial", "no Request Business Access link found");
      } else {
        const bad = dom.trial.filter((p) => p !== "/business/start-trial");
        if (bad.length) fail(locale, "req3-trial", `link(s) point elsewhere: ${bad.join(", ")}`);
        else {
          const res = await api.get("/business/start-trial");
          if (res.status() === 200)
            pass(locale, "req3-trial", `${dom.trial.length} button(s) -> /business/start-trial (200)`);
          else fail(locale, "req3-trial", `/business/start-trial returned ${res.status()}`);
        }
      }

      // --- Requirement 4: support / privacy / terms return 200 --------------
      for (const route of ["/support", "/privacy", "/terms"]) {
        const res = await api.get(route);
        if (res.status() === 200) pass(locale, "req4-pages", `${route} -> 200`);
        else fail(locale, "req4-pages", `${route} returned ${res.status()}`);
      }
    }
  } finally {
    await page.close().catch(() => {});
    await api.dispose().catch(() => {});
    await browser.close().catch(() => {});
    if (server) await new Promise((r) => server.close(r));
  }

  console.log("\n" + "=".repeat(56));
  if (failures.length) {
    console.log(`E2E smoke FAILED: ${failures.length} assertion failure(s).`);
    process.exit(1);
  }
  console.log("E2E smoke passed: all assertions green across en, es, ko.");
}

run().catch((err) => {
  console.error("E2E smoke crashed:", err);
  process.exit(1);
});
