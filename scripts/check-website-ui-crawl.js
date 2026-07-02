const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = process.cwd();
const SITE_ROOT = path.join(ROOT, "website");
const SUPABASE_FUNCTIONS_HOST = "https://kvodhiqhdqnptqovovia.supabase.co/**";
const SCREENSHOT_DIR = process.env.WEBSITE_UI_SCREENSHOT_DIR
  ? path.resolve(process.env.WEBSITE_UI_SCREENSHOT_DIR)
  : "";
const SCREENSHOT_ROUTES = new Set(["/", "/business/start-trial/", "/admin/", "/admin/trial-requests/"]);

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
]);

const ROUTES = [
  "/",
  "/business/",
  "/business/start-trial/",
  "/business/thanks/",
  "/business/waitlist/",
  "/business/review-pending/",
  "/business-terms/",
  "/business/billing/start/",
  "/business/billing/status/",
  "/business/billing/manage/",
  "/business/billing/success/",
  "/business/billing/cancel/",
  "/business/billing/add-payment-method/",
  "/support/",
  "/delete-account/",
  "/terms/",
  "/privacy/",
  "/s/smoke-deal",
  "/admin/login/",
  "/admin/",
  "/admin/trial-requests/",
  "/admin/businesses/",
  "/admin/businesses/new/",
  "/admin/businesses/detail/",
  "/admin/offers/",
  "/admin/billing/events/",
  "/admin/audit-log/",
  "/admin/settings/",
];

const VIEWPORTS = [
  { name: "desktop", width: 1366, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

function routeToFile(pathname) {
  if (pathname === "/") return path.join(SITE_ROOT, "index.html");
  if (pathname.startsWith("/s/") && !path.extname(pathname)) return path.join(SITE_ROOT, "s", "index.html");
  if (/^\/admin\/businesses\/[0-9a-f-]{36}\/?$/i.test(pathname)) {
    return path.join(SITE_ROOT, "admin", "businesses", "detail", "index.html");
  }
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
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
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
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function safeName(value) {
  return value
    .replace(/^\//, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/(^-|-$)/g, "") || "root";
}

function mockPayload(pathname, requestBody) {
  if (pathname.endsWith("/admin-dashboard-summary")) {
    if (requestBody?.section === "businesses") {
      return {
        ok: true,
        admin: { role: "owner" },
        businesses: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "Sample Coffee",
            owner_email: "owner@example.com",
            status: "trialing",
            access_level: "full_trial",
            verification_status: "manual_verified",
            risk_level: "low",
            created_at: "2026-07-02T12:00:00.000Z",
          },
        ],
      };
    }

    if (requestBody?.section === "business_detail") {
      return {
        ok: true,
        admin: { role: "owner" },
        business: {
          id: requestBody.business_id || "11111111-1111-4111-8111-111111111111",
          name: "Sample Coffee",
          status: "trialing",
          access_level: "full_trial",
          verification_status: "manual_verified",
          risk_level: "low",
        },
        applications: [
          {
            contact_name: "Pat Owner",
            email: "pat@example.com",
            status: "trial_active",
            access_tier: "trialing",
            trial_days: 30,
            created_at: "2026-07-02T12:00:00.000Z",
          },
        ],
        audit_log: [
          {
            admin_email: "admin@example.com",
            action: "admin_business_application_approved_full",
            reason: "qa",
            created_at: "2026-07-02T12:01:00.000Z",
          },
        ],
      };
    }

    if (requestBody?.section === "offers") {
      return {
        ok: true,
        admin: { role: "owner" },
        offers: [
          {
            id: "offer-1",
            title: "2-for-1 croissants",
            business_name: "Sample Bakery",
            is_active: true,
            start_time: "2026-07-02T13:00:00.000Z",
            end_time: "2026-07-02T15:00:00.000Z",
            created_at: "2026-07-02T12:00:00.000Z",
          },
        ],
      };
    }

    if (requestBody?.section === "billing_events") {
      return {
        ok: true,
        admin: { role: "owner" },
        billing_events: [
          {
            event_type: "customer.created",
            provider: "stripe",
            processing_status: "processed",
            received_at: "2026-07-02T12:00:00.000Z",
            processed_at: "2026-07-02T12:00:05.000Z",
            error_message: "",
          },
        ],
      };
    }

    if (requestBody?.section === "audit_log") {
      return {
        ok: true,
        admin: { role: "owner" },
        audit_log: [
          {
            admin_email: "admin@example.com",
            action: "admin_login_success",
            target_type: "admin_login",
            business_id: "",
            reason: "",
            created_at: "2026-07-02T12:00:00.000Z",
          },
        ],
      };
    }

    if (requestBody?.section === "settings") {
      return {
        ok: true,
        admin: { role: "owner" },
        launch_areas: [{ name: "DFW", city: "Dallas", state: "TX", status: "active", timezone: "America/Chicago" }],
        feature_flags: [{ key: "share_deal", description: "Share Deal", enabled: true, updated_at: "2026-07-02T12:00:00.000Z" }],
        admin_users: [{ email: "admin@example.com", role: "owner", is_active: true, require_mfa: true, last_admin_login_at: "2026-07-02T12:00:00.000Z" }],
      };
    }

    return {
      ok: true,
      admin: { role: "owner" },
      summary: {
        businesses: { active: 4, pendingVerification: 2, trialingLocations: 1, trialsEndingSoon: 1 },
        trialRequests: { open: 3, highRisk: 1 },
        offers: { live: 7, needsReview: 2 },
        apiSpend: { currentMonthUsd: 1.25, priorMonthUsd: 7.32, updatedAt: "2026-07-02T12:30:00.000Z" },
        activity: { claimsToday: 2, redemptionsToday: 1 },
        billing: { pastDueLocations: 0, pastDueBusinesses: 0, missingStripeCustomers: 1 },
        security: { failedAdminActions: 0 },
      },
      recentApplications: [
        {
          business_name: "Sample Coffee",
          email: "owner@example.com",
          status: "pending_review",
          access_tier: "review_required",
          created_at: "2026-07-02T12:00:00.000Z",
        },
      ],
      recentAudit: [
        {
          action: "admin_login_success",
          target_type: "admin_login",
          reason: "",
          created_at: "2026-07-02T12:01:00.000Z",
        },
      ],
    };
  }

  if (pathname.endsWith("/admin-ai-usage")) {
    const reset = requestBody?.action === "reset_quota";
    const business = {
      id: "business-1",
      name: "Sample Coffee",
      status: "trialing",
      usage: [
        {
          scope: "ad_generation",
          used: reset ? 0 : 4,
          limit: 25,
          remaining: reset ? 25 : 21,
          countSince: "2026-07-01T00:00:00.000Z",
          resetAt: reset ? "2026-07-02T12:40:00.000Z" : null,
        },
      ],
    };
    return { ok: true, user: { id: "user-1", email: "owner@example.com" }, businesses: [business], business };
  }

  if (pathname.endsWith("/admin-business-applications")) {
    return {
      ok: true,
      business_linked: false,
      applications: [
        {
          id: "app-1",
          business_name: "Sample Bakery",
          contact_name: "Pat Owner",
          email: "pat@example.com",
          launch_area: "Dallas",
          risk_score: 12,
          status: "pending_review",
          business_type: "bakery",
          address: "123 Main",
          slow_hours: "2-4 PM",
          offer_interests: "BOGO pastries",
          risk_reasons: ["new domain"],
        },
      ],
    };
  }

  if (pathname.endsWith("/admin-auth-session")) {
    return { ok: true, session: { access_token: "mock-token", refresh_token: "mock-refresh", expires_in: 3600 } };
  }

  if (pathname.endsWith("/submit-business-application")) {
    return { ok: true, application_id: "app-1" };
  }

  return { ok: true };
}

async function installMocks(page) {
  await page.route(SUPABASE_FUNCTIONS_HOST, async (route) => {
    let body = {};
    try {
      body = JSON.parse(route.request().postData() || "{}");
    } catch {
      body = {};
    }
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockPayload(url.pathname, body)),
    });
  });
}

async function prepareStorage(context, route) {
  await context.addInitScript((currentRoute) => {
    localStorage.clear();
    sessionStorage.clear();
    if (currentRoute.startsWith("/admin/") && currentRoute !== "/admin/login/") {
      localStorage.setItem("twofer_admin_access_token", "mock-token");
      localStorage.setItem("twofer_admin_refresh_token", "mock-refresh");
      localStorage.setItem("twofer_admin_expires_at", String(Date.now() + 3600 * 1000));
    }
  }, route);
}

function isPublicRoute(route) {
  return !route.startsWith("/admin");
}

function isAdminRoute(route) {
  return route.startsWith("/admin");
}

async function pageDiagnostics(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const textOverflow = [...document.querySelectorAll("button, .button, .admin-badge, .language-set button")]
      .filter((el) => el.offsetParent !== null && el.scrollWidth > el.clientWidth + 2)
      .map((el) => (el.textContent || "").trim().slice(0, 60));
    return {
      horizontalOverflow: doc.scrollWidth > doc.clientWidth + 2,
      brokenImages: [...document.images]
        .filter((img) => img.complete && img.naturalWidth === 0)
        .map((img) => img.getAttribute("src")),
      textOverflow,
      notifyText: /\bNotify Me\b/i.test(document.body?.innerText || ""),
      staleCache: document.documentElement.outerHTML.includes("20260701-logo"),
      bodyTextLength: document.body?.innerText?.length || 0,
    };
  });
}

async function checkPublicLanguage(page, route) {
  if (!(await page.locator('[data-language-option="es"]').count())) return [];
  const before = (await page.locator("h1").first().textContent().catch(() => "")) || "";
  await page.locator('[data-language-option="es"]').first().click();
  await page.waitForTimeout(80);
  const esLang = await page.locator("html").evaluate((el) => el.lang);
  const es = (await page.locator("h1").first().textContent().catch(() => "")) || "";
  await page.locator('[data-language-option="ko"]').first().click();
  await page.waitForTimeout(80);
  const koLang = await page.locator("html").evaluate((el) => el.lang);
  const ko = (await page.locator("h1").first().textContent().catch(() => "")) || "";
  const issues = [];
  if (esLang !== "es") issues.push(`${route}: Spanish switch did not set html lang`);
  if (koLang !== "ko") issues.push(`${route}: Korean switch did not set html lang`);
  if (before && es && before === es) issues.push(`${route}: Spanish h1 did not change`);
  if (before && ko && before === ko) issues.push(`${route}: Korean h1 did not change`);
  await page.locator('[data-language-option="en"]').first().click();
  await page.waitForTimeout(80);
  return issues;
}

async function checkMobileMenu(page, route) {
  if (!(await page.locator("[data-site-menu-toggle]").count())) return [];
  const before = await page.locator(".nav-links").first().evaluate((el) => getComputedStyle(el).display);
  await page.locator("[data-site-menu-toggle]").first().click();
  await page.waitForTimeout(80);
  const after = await page.locator(".nav-links").first().evaluate((el) => getComputedStyle(el).display);
  const expanded = await page.locator("[data-site-menu-toggle]").first().getAttribute("aria-expanded");
  const issues = [];
  if (before !== "none") issues.push(`${route}: mobile menu links should be collapsed initially`);
  if (after === "none") issues.push(`${route}: mobile menu links did not open`);
  if (expanded !== "true") issues.push(`${route}: mobile menu aria-expanded did not update`);
  await page.locator("[data-site-menu-toggle]").first().click();
  await page.waitForTimeout(80);
  return issues;
}

async function checkTrialMobilePosition(page) {
  return page.evaluate(() => {
    const form = document.querySelector("#business-application");
    return {
      formTop: form ? Math.round(form.getBoundingClientRect().top + window.scrollY) : null,
      hasJump: Boolean(document.querySelector(".trial-jump")),
    };
  });
}

async function checkAdminMobileNav(page, route) {
  if (!(await page.locator(".admin-shell .nav-links").count())) return [];
  const display = await page.locator(".admin-shell .nav-links").first().evaluate((el) => getComputedStyle(el).display);
  return display === "none" ? [`${route}: admin mobile navigation links are hidden`] : [];
}

async function checkAdminDashboard(page) {
  const issues = [];
  await page
    .waitForFunction(() => document.querySelector("[data-admin-status]")?.textContent?.includes("Signed in"), null, {
      timeout: 5000,
    })
    .catch(() => issues.push("/admin/: summary did not load signed-in state"));
  await page.locator('input[name="query"]').fill("owner@example.com");
  await page.locator('[data-ai-quota-form] button[type="submit"]').click();
  await page
    .waitForFunction(() => document.querySelector("[data-ai-usage-body]")?.innerText?.includes("Sample Coffee"), null, {
      timeout: 5000,
    })
    .catch(() => issues.push("/admin/: AI usage lookup did not populate usage rows"));
  const resetEnabled = await page.locator("[data-ai-reset-button]").evaluate((button) => !button.disabled).catch(() => false);
  if (!resetEnabled) issues.push("/admin/: reset button stayed disabled after usage lookup");
  if (resetEnabled) {
    await page.locator("[data-ai-reset-button]").click();
    await page
      .waitForFunction(() => document.querySelector("[data-ai-quota-status]")?.textContent?.includes("Reset"), null, {
        timeout: 5000,
      })
      .catch(() => issues.push("/admin/: quota reset status did not confirm reset"));
  }
  const mobileLabels = await page.evaluate(() =>
    [...document.querySelectorAll(".admin-table[data-mobile-cards] tbody td")]
      .filter((td) => td.className !== "admin-row-detail")
      .every((td) => Boolean(td.dataset.label)),
  );
  if (!mobileLabels) issues.push("/admin/: generated mobile table cells are missing labels");
  return issues;
}

async function checkTrialRequests(page) {
  const issues = [];
  await page
    .waitForFunction(() => document.querySelector("[data-trial-requests-body]")?.innerText?.includes("Sample Bakery"), null, {
      timeout: 5000,
    })
    .catch(() => issues.push("/admin/trial-requests/: applications did not load"));
  const limitedButton = page.locator('button[data-decision="approve_limited"]').first();
  if (await limitedButton.count()) {
    await limitedButton.click();
    await page
      .waitForFunction(() => !document.querySelector("[data-trial-status]")?.textContent?.includes("Saving decision"), null, {
        timeout: 5000,
      })
      .catch(() => issues.push("/admin/trial-requests/: limited decision did not complete"));
    const decisionStatus = await page.locator("[data-trial-status]").textContent().catch(() => "");
    if (/NetworkError|Could not save decision/i.test(decisionStatus || "")) {
      issues.push(`/admin/trial-requests/: limited decision surfaced ${decisionStatus}`);
    }
  } else {
    issues.push("/admin/trial-requests/: limited decision button was missing");
  }
  const mobileLabels = await page.evaluate(() =>
    [...document.querySelectorAll(".admin-table[data-mobile-cards] tbody td")]
      .filter((td) => td.className !== "admin-row-detail")
      .every((td) => Boolean(td.dataset.label)),
  );
  if (!mobileLabels) issues.push("/admin/trial-requests/: generated mobile table cells are missing labels");
  return issues;
}

async function crawlRoute(browser, baseUrl, route, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await prepareStorage(context, route);
  const page = await context.newPage();
  await installMocks(page);

  const issues = [];
  page.on("pageerror", (error) => issues.push(`${route} ${viewport.name}: page error ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") issues.push(`${route} ${viewport.name}: console error ${message.text()}`);
  });
  page.on("response", (response) => {
    const url = response.url();
    if (url.startsWith(baseUrl) && response.status() >= 400 && !url.endsWith("/favicon.ico")) {
      issues.push(`${route} ${viewport.name}: ${response.status()} ${url.replace(baseUrl, "")}`);
    }
  });

  await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(250);

  const diagnostics = await pageDiagnostics(page);
  if (!diagnostics.bodyTextLength) issues.push(`${route} ${viewport.name}: body rendered empty`);
  if (diagnostics.horizontalOverflow) issues.push(`${route} ${viewport.name}: horizontal overflow`);
  if (diagnostics.brokenImages.length) issues.push(`${route} ${viewport.name}: broken images ${diagnostics.brokenImages.join(", ")}`);
  if (diagnostics.textOverflow.length) issues.push(`${route} ${viewport.name}: text overflow ${diagnostics.textOverflow.join(" | ")}`);
  if (diagnostics.notifyText) issues.push(`${route} ${viewport.name}: stale Notify Me copy is visible`);
  if (diagnostics.staleCache) issues.push(`${route} ${viewport.name}: stale 20260701 logo cache key`);

  if (isPublicRoute(route) && route !== "/business/" && viewport.name === "desktop") {
    issues.push(...(await checkPublicLanguage(page, route)));
  }
  if (isPublicRoute(route) && viewport.name === "mobile") {
    issues.push(...(await checkMobileMenu(page, route)));
  }
  if (isAdminRoute(route) && viewport.name === "mobile") {
    issues.push(...(await checkAdminMobileNav(page, route)));
  }
  if (route === "/business/start-trial/" && viewport.name === "mobile") {
    const trialMobile = await checkTrialMobilePosition(page);
    if (!trialMobile.hasJump) issues.push("/business/start-trial/: missing mobile form jump");
    if (trialMobile.formTop === null || trialMobile.formTop > 760) {
      issues.push(`/business/start-trial/: form starts too low on mobile (${trialMobile.formTop})`);
    }
  }
  if (route === "/admin/" && viewport.name === "mobile") issues.push(...(await checkAdminDashboard(page)));
  if (route === "/admin/trial-requests/" && viewport.name === "mobile") issues.push(...(await checkTrialRequests(page)));

  if (SCREENSHOT_DIR && SCREENSHOT_ROUTES.has(route)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `${viewport.name}-${safeName(route)}.png`),
      fullPage: true,
    });
  }

  await context.close();
  return issues;
}

async function main() {
  const server = createServer();
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ headless: true });
  const failures = [];

  try {
    for (const viewport of VIEWPORTS) {
      for (const route of ROUTES) {
        failures.push(...(await crawlRoute(browser, baseUrl, route, viewport)));
      }
    }
  } finally {
    await browser.close();
    await closeServer(server);
  }

  if (failures.length > 0) {
    console.error("Website UI crawl failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log(`Website UI crawl passed for ${ROUTES.length} routes across ${VIEWPORTS.length} viewports.`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
