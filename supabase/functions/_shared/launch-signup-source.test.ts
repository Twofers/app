import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("launch signup intake", () => {
  it("keeps the launch_signups table RLS-closed to public client roles", () => {
    const migration = read("supabase/migrations/20260805120000_launch_signups.sql");
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.launch_signups/i);
    expect(migration).toMatch(/ALTER TABLE public\.launch_signups ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/REVOKE ALL ON public\.launch_signups FROM anon, authenticated/i);
    // Dedupe: emails are stored lowercased by the function, so a plain
    // UNIQUE column constraint is enough and PostgREST can upsert on it.
    expect(migration).toMatch(/email text NOT NULL UNIQUE/i);
    // No client-facing policies on purpose: only service_role touches rows.
    expect(migration).not.toMatch(/CREATE POLICY/i);
  });

  it("validates, throttles, and dedupes in the Edge Function without leaking state", () => {
    const source = read("supabase/functions/submit-launch-signup/index.ts");
    // A honeypot field short-circuits obvious bots before any DB work,
    // answering ok so bots cannot tell they were dropped.
    expect(source).toMatch(/cleanString\(payload\.company_website/);
    // Email is validated/normalized by the shared helper (lowercases).
    expect(source).toMatch(/cleanEmail\(payload\.email\)/);
    // Per-IP throttle with a finite ceiling, keyed off x-forwarded-for,
    // answering HTTP 429 when exceeded.
    expect(source).toMatch(/const RATE_LIMIT_WINDOW_MINUTES\s*=\s*\d+/);
    expect(source).toMatch(/const RATE_LIMIT_MAX_PER_IP\s*=\s*\d+/);
    expect(source).toMatch(/firstForwardedIp\(req\.headers\.get\("x-forwarded-for"\)\)/);
    expect(source).toMatch(/\},\s*429\)/);
    // The rate-limit gate must run BEFORE the row is written.
    const rateLimitIndex = source.indexOf("isRateLimited(supabase");
    const insertIndex = source.indexOf('from("launch_signups")\n      .upsert');
    expect(rateLimitIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(rateLimitIndex);
    // Duplicate submissions are silently ignored so the response never
    // reveals whether an email was already on the list.
    expect(source).toMatch(/ignoreDuplicates: true/);
    // Locale and source values are constrained to known allowlists.
    expect(source).toMatch(/ALLOWED_LOCALES/);
    expect(source).toMatch(/ALLOWED_SOURCES/);
    // No provider secrets belong anywhere near this function.
    expect(source).not.toMatch(/STRIPE_SECRET_KEY/);
    expect(source).not.toMatch(/OPENAI_API_KEY/);
  });

  it("registers the function as public (no JWT) in supabase config", () => {
    const config = read("supabase/config.toml");
    expect(config).toMatch(/\[functions\.submit-launch-signup\][^[]*verify_jwt = false/);
  });

  it("wires the website form to the function with graceful failure copy", () => {
    const page = read("website/index.html");
    expect(page).toMatch(/data-launch-signup-endpoint="https:\/\/[a-z]+\.supabase\.co\/functions\/v1\/submit-launch-signup"/);
    expect(page).toMatch(/data-launch-signup /);
    expect(page).toMatch(/name="company_website"/);
    const script = read("website/launch-signup.js");
    expect(script).toMatch(/home\.signupError/);
    expect(script).toMatch(/support@twoferapp\.com/);
    expect(script).toMatch(/response\.status === 429/);
  });
});
