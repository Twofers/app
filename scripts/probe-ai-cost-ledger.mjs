#!/usr/bin/env node
/**
 * Dev-only manual probe for the private AI cost ledger.
 *
 * Required env:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * - SUPABASE_USER_JWT for an owner account
 * - BUSINESS_ID owned by that JWT
 *
 * Optional env:
 * - PHOTO_PATH for uploaded-photo edit flow
 * - OUTPUT_LANGUAGE, default en
 *
 * This script does not print secrets. It prints only the request group, models,
 * endpoints, usage fields, and estimated cost rows found in ai_generation_costs.
 */

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_USER_JWT", "BUSINESS_ID"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required env: ${missing.join(", ")}`);
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL.replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const userJwt = process.env.SUPABASE_USER_JWT;
const businessId = process.env.BUSINESS_ID;
const requestGroupId = crypto.randomUUID();

const body = {
  business_id: businessId,
  hint_text: "bagel and coffee",
  output_language: process.env.OUTPUT_LANGUAGE || "en",
  request_group_id: requestGroupId,
  business_context: {
    location: "Irving, TX",
  },
  offer_schedule_summary: "Today, 2 PM to 5 PM",
  quantity_limit: 10,
  redemption_limit: "One per customer.",
  deal_eligibility: {
    dealType: "BOGO",
    appliesTo: "SINGLE_ITEM",
    requiredPurchaseQuantity: 1,
    freeItemQuantity: 1,
    requiredItemDescription: "bagel and coffee",
    freeItemDescription: "bagel and coffee",
    freeItemDiscountPercent: 100,
  },
};

if (process.env.PHOTO_PATH) {
  body.photo_path = process.env.PHOTO_PATH;
  body.photo_treatment = "studiopolish";
}

const invokeRes = await fetch(`${supabaseUrl}/functions/v1/ai-generate-ad-variants`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${userJwt}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

const invokeJson = await invokeRes.json().catch(() => ({}));
if (!invokeRes.ok) {
  console.error(`Generation failed: HTTP ${invokeRes.status}`);
  console.error(JSON.stringify(invokeJson, null, 2));
  process.exit(1);
}

console.log(`request_group_id: ${requestGroupId}`);
console.log(`ad_headline: ${invokeJson?.ad?.headline ?? "(missing)"}`);
console.log(`poster_storage_path: ${invokeJson?.ad?.poster_storage_path ?? "(none)"}`);

const query = new URL(`${supabaseUrl}/rest/v1/ai_generation_costs`);
query.searchParams.set("request_group_id", `eq.${requestGroupId}`);
query.searchParams.set(
  "select",
  "feature,model,endpoint,input_tokens,cached_input_tokens,output_tokens,image_input_tokens,image_output_tokens,image_text_input_tokens,audio_seconds,web_search_calls,estimated_cost_usd,success,error_code,error_message",
);
query.searchParams.set("order", "created_at.asc");

const ledgerRes = await fetch(query, {
  headers: {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  },
});
const rows = await ledgerRes.json().catch(() => []);
if (!ledgerRes.ok) {
  console.error(`Ledger read failed: HTTP ${ledgerRes.status}`);
  console.error(JSON.stringify(rows, null, 2));
  process.exit(1);
}

let total = 0;
for (const row of rows) {
  total += Number(row.estimated_cost_usd || 0);
  console.log(
    [
      row.feature,
      row.model,
      row.endpoint,
      `in=${row.input_tokens}`,
      `cached=${row.cached_input_tokens}`,
      `out=${row.output_tokens}`,
      `img_in=${row.image_input_tokens}`,
      `img_out=${row.image_output_tokens}`,
      `img_text=${row.image_text_input_tokens}`,
      `audio_s=${row.audio_seconds}`,
      `web=${row.web_search_calls}`,
      `cost=$${row.estimated_cost_usd}`,
      `success=${row.success}`,
      row.error_code ? `error=${row.error_code}` : "",
    ].filter(Boolean).join(" | "),
  );
}

console.log(`total_estimated_cost_usd: ${total.toFixed(6)}`);
console.log(`web_search_used: ${rows.some((row) => Number(row.web_search_calls || 0) > 0) ? "yes" : "no"}`);
console.log(`image_logged: ${rows.some((row) => String(row.endpoint || "").startsWith("images.")) ? "yes" : "no"}`);
