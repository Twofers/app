import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:8081";
const OUT_DIR = process.env.SCREENSHOT_OUT_DIR ?? path.join(process.cwd(), "screenshots");

function safeName(input) {
  return String(input)
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 140);
}

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

async function shot(page, name, { fullPage = true } = {}) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  return file;
}

async function gotoAndWait(page, route) {
  const url = new URL(route, BASE_URL).toString();
  await page.goto(url, { waitUntil: "load", timeout: 120_000 });
  await page.waitForTimeout(800);
}

async function clickIfVisible(page, locator) {
  try {
    await locator.first().waitFor({ state: "visible", timeout: 1500 });
    await locator.first().click({ timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

async function trySmokeLogin(page) {
  // Optional local smoke login. Credentials must come from local-only env vars.
  // We keep selectors text-based because RN Web doesn't expose stable testIDs by default.
  const smokeEmail = process.env.TWOFER_SMOKE_EMAIL;
  const smokePassword = process.env.TWOFER_SMOKE_PASSWORD;
  if (!smokeEmail || !smokePassword) {
    console.warn(
      "Skipping login fallback: set TWOFER_SMOKE_EMAIL and TWOFER_SMOKE_PASSWORD locally if this screenshot run needs auth.",
    );
    return false;
  }
  try {
    await page.getByLabel(/email/i).fill(smokeEmail);
    await page.getByLabel(/password/i).fill(smokePassword);
  } catch {
    // RN Web often doesn't wire labels; fall back to placeholders and first/second input.
    const inputs = page.locator("input");
    await inputs.nth(0).fill(smokeEmail);
    await inputs.nth(1).fill(smokePassword);
  }
  await clickIfVisible(page, page.getByText(/^log in$/i));
  try {
    await page.waitForURL((u) => !u.toString().includes("/auth-landing"), { timeout: 20_000 });
  } catch {
    // ignored
  }
  await page.waitForTimeout(1200);
  return await page.getByText(/settings|wallet|map|create|dashboard/i).first().isVisible().catch(() => false);
}

async function takeRouteShots(page, routes, prefix) {
  const results = [];
  for (const route of routes) {
    const name = `${prefix}-${safeName(route.replace(/^\//, "")) || "root"}`;
    try {
      await gotoAndWait(page, route);
      const file = await shot(page, name);
      results.push({ route, ok: true, file });
    } catch (e) {
      results.push({ route, ok: false, error: String(e) });
    }
  }
  return results;
}

async function main() {
  await ensureDir(OUT_DIR);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone 14-ish
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(120_000);
  page.setDefaultTimeout(30_000);

  const report = {
    baseUrl: BASE_URL,
    outDir: OUT_DIR,
    startedAt: new Date().toISOString(),
    shots: [],
    notes: [
      "If you want desktop/tablet screenshots, rerun with SCREENSHOT_VIEWPORT=desktop (not implemented yet).",
      "If auth screenshots need a real session, set TWOFER_SMOKE_EMAIL and TWOFER_SMOKE_PASSWORD locally.",
    ],
  };

  // Public-ish routes
  await gotoAndWait(page, "/auth-landing");
  report.shots.push({ route: "/auth-landing", ok: true, file: await shot(page, "01-auth-landing") });

  await gotoAndWait(page, "/forgot-password");
  report.shots.push({ route: "/forgot-password", ok: true, file: await shot(page, "02-forgot-password") });

  // Reset password normally needs a recovery token; still capture base UI if it renders.
  await gotoAndWait(page, "/reset-password");
  report.shots.push({ route: "/reset-password", ok: true, file: await shot(page, "03-reset-password") });

  // Use an opt-in web-only bypass so screenshots do not need committed credentials.
  // Use an opt-in web-only bypass for screenshot capture (no real auth session needed).
  await gotoAndWait(page, "/?e2e=1&mode=customer");
  const demoOk = true;
  report.shots.push({ route: "/?e2e=1&mode=customer", ok: true, file: await shot(page, "04-after-e2e-bypass") });
  // Some projects keep the tab "home" behind the group path; capture both.
  report.shots.push(
    ...(await takeRouteShots(page, ["/(tabs)?e2e=1&mode=customer", "/(tabs)/index?e2e=1&mode=customer"], "05-tabs-home"))
  );

  if (demoOk) {
    // Customer mode
    await gotoAndWait(page, "/account?e2e=1&mode=customer");
    await clickIfVisible(page, page.getByRole("button", { name: /customer/i }));
    await page.waitForTimeout(600);
    report.shots.push({ route: "/(tabs)/account (customer mode)", ok: true, file: await shot(page, "10-account-customer") });

    report.shots.push(
      ...(await takeRouteShots(
        page,
        [
          "/(tabs)?e2e=1&mode=customer",
          "/(tabs)/map?e2e=1&mode=customer",
          "/(tabs)/wallet?e2e=1&mode=customer",
          "/(tabs)/settings?e2e=1&mode=customer",
        ],
        "11-customer"
      ))
    );

    // Business mode
    await gotoAndWait(page, "/(tabs)/account?e2e=1&mode=business");
    report.shots.push({ route: "/(tabs)/account (business mode)", ok: true, file: await shot(page, "20-account-business") });

    report.shots.push(
      ...(await takeRouteShots(
        page,
        [
          "/(tabs)/create?e2e=1&mode=business",
          "/create/quick?e2e=1",
          "/create/reuse?e2e=1",
          "/create/ai-compose?e2e=1",
          "/create/ai?e2e=1",
          "/(tabs)/redeem?e2e=1&mode=business",
          "/(tabs)/dashboard?e2e=1&mode=business",
        ],
        "21-business"
      ))
    );

    // Other stack routes that can be reached while authed
    report.shots.push(
      ...(await takeRouteShots(
        page,
        [
          "/onboarding?e2e=1&mode=customer",
          "/consumer-profile-setup?e2e=1&mode=customer",
          "/business-setup?e2e=1&mode=business",
          "/debug-diagnostics?e2e=1&mode=customer",
        ],
        "30-stack"
      ))
    );
  }

  report.finishedAt = new Date().toISOString();
  const reportFile = path.join(OUT_DIR, "report.json");
  await fs.promises.writeFile(reportFile, JSON.stringify(report, null, 2), "utf8");

  // eslint-disable-next-line no-console
  console.log(`Saved screenshots to: ${OUT_DIR}`);
  // eslint-disable-next-line no-console
  console.log(`Report: ${reportFile}`);

  await context.close();
  await browser.close();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});

