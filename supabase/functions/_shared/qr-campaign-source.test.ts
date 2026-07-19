import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("QR campaign tracking source contract", () => {
  const migrationPath = "supabase/migrations/20260815130000_qr_campaign_tracking.sql";

  it("creates closed campaign/event tables with server-derived scan recording", () => {
    const migration = read(migrationPath);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.qr_campaigns/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.qr_scan_events/i);
    expect(migration).toMatch(/business_id uuid NOT NULL REFERENCES public\.businesses/i);
    expect(migration).toMatch(/campaign_id uuid NOT NULL REFERENCES public\.qr_campaigns/i);
    expect(migration).toMatch(/source_type IN \('counter_sign', 'window_sticker', 'flyer', 'coaster', 'table_tent', 'other'\)/i);
    expect(migration).toMatch(/destination_type IN \('app_download', 'website'\)/i);
    expect(migration).toMatch(/ALTER TABLE public\.qr_campaigns ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/ALTER TABLE public\.qr_scan_events ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.qr_campaigns FROM anon, authenticated/i);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.qr_scan_events FROM anon, authenticated/i);
    expect(migration).toMatch(/GRANT SELECT, INSERT, UPDATE ON TABLE public\.qr_campaigns TO service_role/i);
    expect(migration).toMatch(/GRANT SELECT, INSERT, UPDATE ON TABLE public\.qr_scan_events TO service_role/i);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.record_qr_campaign_scan/i);
    expect(migration).toMatch(/WHERE slug = lower\(trim\(p_slug\)\)[\s\S]*AND is_active = true/i);
    expect(migration).toMatch(/v_campaign\.business_id/i);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.qr_campaign_analytics/i);
    expect(migration).toMatch(/redact_expired_qr_scan_metadata/i);
  });

  it("uses a scalar generated-day column for the analytics daily series", () => {
    const fix = read("supabase/migrations/20260815131000_fix_qr_campaign_analytics_daily_series.sql");
    expect(fix).toMatch(/generate_series\(v_since::date, current_date, interval '1 day'\) AS series\(scan_day\)/i);
    expect(fix).toMatch(/scan_day::date AS scan_date/i);
    expect(fix).toMatch(/e\.scanned_at >= scan_day[\s\S]*e\.scanned_at < scan_day \+ interval '1 day'/i);
  });

  it("qualifies scan-event rate-limit columns inside the recording RPC", () => {
    const fix = read("supabase/migrations/20260815132000_fix_qr_campaign_scan_event_recording.sql");
    expect(fix).toMatch(/FROM public\.qr_scan_events AS e[\s\S]*WHERE e\.campaign_id = v_campaign\.id/i);
    expect(fix).toMatch(/AND e\.ip_hash = p_ip_hash/i);
    expect(fix).toMatch(/RETURN QUERY SELECT v_campaign\.id[\s\S]*true/i);
  });

  it("keeps public redirects private, non-cacheable, and fail-open for conversion", () => {
    const source = read("supabase/functions/qr-campaign-redirect/index.ts");
    expect(source).toMatch(/clientIpFromRequest\(req\)/);
    expect(source).toMatch(/dailyQrIpHash/);
    expect(source).toMatch(/record_qr_campaign_scan/);
    expect(source).toMatch(/Cache-Control": "no-store, private, max-age=0/);
    expect(source).toMatch(/X-Robots-Tag": "noindex, nofollow/);
    expect(source).toMatch(/Referrer-Policy": "no-referrer/);
    expect(source).toMatch(/return redirect\(destination\.url\)/);
    expect(source).not.toMatch(/from\("qr_scan_events"\)\.insert/);
    expect(source).not.toMatch(/console\.error\([^\n]*ipHash/i);
  });

  it("registers both functions and maps the public printed URL through Vercel", () => {
    const config = read("supabase/config.toml");
    const vercel = read("website/vercel.json");
    expect(config).toMatch(/\[functions\.qr-campaign-redirect\][\s\S]*verify_jwt\s*=\s*false[\s\S]*entrypoint\s*=\s*"\.\/functions\/qr-campaign-redirect\/index\.ts"/);
    expect(config).toMatch(/\[functions\.admin-qr-campaigns\][\s\S]*verify_jwt\s*=\s*false[\s\S]*entrypoint\s*=\s*"\.\/functions\/admin-qr-campaigns\/index\.ts"/);
    expect(vercel).toContain('"source": "/r/:slug"');
    expect(vercel).toContain("qr-campaign-redirect?slug=:slug");
    expect(vercel).toContain('"source": "/admin/qr-campaigns"');
    expect(vercel).toContain('"destination": "/admin/qr-campaigns/index.html"');
  });

  it("keeps campaign management behind explicit admin permissions and local QR rendering", () => {
    const helper = read("supabase/functions/_shared/admin-prospects.ts");
    const source = read("supabase/functions/admin-qr-campaigns/index.ts");
    const page = read("website/admin/qr-campaigns/index.html");
    const script = read("website/admin/qr-campaigns.js");
    expect(helper).toMatch(/"qr\.read"/);
    expect(helper).toMatch(/"qr\.manage"/);
    expect(source).toMatch(/requireAdmin\(req, requestId, permission\)/);
    expect(source).toMatch(/admin_qr_campaign_created/);
    expect(source).toMatch(/admin_qr_campaign_disabled/);
    expect(source).toMatch(/npm:qrcode@1\.5\.4/);
    expect(page).toMatch(/data-admin-qr-campaigns-endpoint/);
    expect(page).toMatch(/Every code uses a Twofer redirect URL, never a direct store link/i);
    expect(script).toMatch(/action: "create"/);
    expect(script).toMatch(/action: "disable"/);
    expect(script).toMatch(/action: "qr"/);
    expect(page).not.toMatch(/quickchart|googleapis\.com\/chart/i);
  });
});
