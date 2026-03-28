/**
 * Pilot smoke test: merchant publishes deal → consumer claims → merchant redeems.
 *
 * Usage:
 *   npx tsx scripts/pilot-smoke-test.ts
 *
 * Requires:
 *   - Local Supabase running (`npx supabase start`)
 *   - Demo account seeded (`npm run seed:demo`)
 *   - EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in .env");
  process.exit(1);
}

const MERCHANT_EMAIL = "demo@demo.com";
const MERCHANT_PASSWORD = "demo12345";
const CONSUMER_EMAIL = "test-consumer@twofer.test";
const CONSUMER_PASSWORD = "testpass123";

async function run() {
  console.log("=== Twofer Pilot Smoke Test ===\n");

  // --- Step 1: Sign in as merchant ---
  console.log("1. Signing in as merchant...");
  const merchantClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: mAuth, error: mAuthErr } = await merchantClient.auth.signInWithPassword({
    email: MERCHANT_EMAIL,
    password: MERCHANT_PASSWORD,
  });
  if (mAuthErr) {
    console.error("   FAIL: Merchant sign-in failed:", mAuthErr.message);
    console.log("   Hint: Run `npm run seed:demo` first.");
    process.exit(1);
  }
  console.log("   OK: Signed in as", mAuth.user?.email);

  // --- Step 2: Get merchant's business ---
  console.log("2. Looking up merchant business...");
  const { data: biz, error: bizErr } = await merchantClient
    .from("businesses")
    .select("id, name")
    .eq("owner_id", mAuth.user!.id)
    .limit(1)
    .single();
  if (bizErr || !biz) {
    console.error("   FAIL: No business found for merchant:", bizErr?.message);
    process.exit(1);
  }
  console.log("   OK: Business =", biz.name, `(${biz.id})`);

  // --- Step 3: Publish a deal ---
  console.log("3. Publishing a test deal...");
  const endTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const { data: deal, error: dealErr } = await merchantClient.from("deals").insert({
    business_id: biz.id,
    title: "BOGO drip coffee — smoke test",
    description: "Buy one get one free drip coffee",
    price: 3.50,
    start_time: new Date().toISOString(),
    end_time: endTime,
    max_claims: 10,
    claim_cutoff_buffer_minutes: 5,
    is_active: true,
  }).select("id, title").single();
  if (dealErr || !deal) {
    console.error("   FAIL: Deal creation failed:", dealErr?.message);
    process.exit(1);
  }
  console.log("   OK: Deal created =", deal.title, `(${deal.id})`);

  // --- Step 4: Sign up / sign in as consumer ---
  console.log("4. Signing in as consumer...");
  const consumerClient = createClient(SUPABASE_URL, ANON_KEY);
  let { error: cAuthErr } = await consumerClient.auth.signInWithPassword({
    email: CONSUMER_EMAIL,
    password: CONSUMER_PASSWORD,
  });
  if (cAuthErr) {
    console.log("   Consumer account doesn't exist, creating...");
    const { error: signUpErr } = await consumerClient.auth.signUp({
      email: CONSUMER_EMAIL,
      password: CONSUMER_PASSWORD,
    });
    if (signUpErr) {
      console.error("   FAIL: Consumer sign-up failed:", signUpErr.message);
      process.exit(1);
    }
    const r = await consumerClient.auth.signInWithPassword({
      email: CONSUMER_EMAIL,
      password: CONSUMER_PASSWORD,
    });
    if (r.error) {
      console.error("   FAIL: Consumer sign-in after signup:", r.error.message);
      process.exit(1);
    }
  }
  console.log("   OK: Signed in as consumer");

  // --- Step 5: Consumer claims deal ---
  console.log("5. Consumer claiming deal...");
  const { data: claimResult, error: claimErr } = await consumerClient.functions.invoke(
    "claim-deal",
    { body: { deal_id: deal.id } },
  );
  if (claimErr) {
    console.error("   FAIL: Claim failed:", claimErr.message);
    process.exit(1);
  }
  if (claimResult?.error) {
    console.error("   FAIL: Claim error:", claimResult.error);
    process.exit(1);
  }
  const token = claimResult?.token;
  if (!token) {
    console.error("   FAIL: No token in claim response");
    process.exit(1);
  }
  console.log("   OK: Claimed! Token =", token.slice(0, 12) + "...");

  // --- Step 6: Merchant redeems token ---
  console.log("6. Merchant redeeming token...");
  const { data: redeemResult, error: redeemErr } = await merchantClient.functions.invoke(
    "redeem-token",
    { body: { token } },
  );
  if (redeemErr) {
    console.error("   FAIL: Redeem failed:", redeemErr.message);
    process.exit(1);
  }
  if (redeemResult?.error) {
    console.error("   FAIL: Redeem error:", redeemResult.error);
    process.exit(1);
  }
  console.log("   OK: Redeemed at", redeemResult?.redeemed_at);

  // --- Step 7: Verify final state ---
  console.log("7. Verifying final claim state...");
  const { data: finalClaim } = await merchantClient
    .from("deal_claims")
    .select("id, claim_status, redeemed_at, redeem_method")
    .eq("token", token)
    .single();
  if (!finalClaim?.redeemed_at) {
    console.error("   FAIL: Claim not marked redeemed");
    process.exit(1);
  }
  console.log("   OK: Status =", finalClaim.claim_status, "| Method =", finalClaim.redeem_method);

  // --- Cleanup ---
  console.log("\n8. Cleaning up test deal...");
  await merchantClient.from("deals").update({ is_active: false }).eq("id", deal.id);
  console.log("   OK: Deal deactivated");

  console.log("\n=== ALL CHECKS PASSED ===");
}

run().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
