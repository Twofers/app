import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const migration = "supabase/migrations/20260802120000_business_prospect_command_center.sql";
const prospectFunctions = [
  "supabase/functions/public-local-businesses/index.ts",
  "supabase/functions/request-business-on-twofer/index.ts",
  "supabase/functions/admin-prospect-import/index.ts",
  "supabase/functions/admin-prospect-enrich/index.ts",
  "supabase/functions/admin-prospect-score/index.ts",
  "supabase/functions/admin-demand-proof/index.ts",
  "supabase/functions/admin-sales-script/index.ts",
  "supabase/functions/admin-onboarding-review-ai/index.ts",
  "supabase/functions/admin-prospect-sales/index.ts",
  "supabase/functions/admin-claim-link-create/index.ts",
  "supabase/functions/admin-claim-link-assistant/index.ts",
  "supabase/functions/business-claim-link/index.ts",
  "supabase/functions/admin-trial-create-from-prospect/index.ts",
  "supabase/functions/admin-trial-conversion-assistant/index.ts",
  "supabase/functions/admin-ai-operating-report/index.ts",
  "supabase/functions/admin-ai-prompts/index.ts",
];

describe("website prospect command center", () => {
  it("adds the prospect schema without creating fake deals", () => {
    const sql = read(migration);
    for (const table of [
      "business_prospects",
      "business_prospect_sources",
      "business_prospect_enrichments",
      "business_demand_signals",
      "business_demand_rollups",
      "business_prospect_scores",
      "sales_accounts",
      "business_claim_links",
      "prospect_to_business_links",
    ]) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`, "i"));
      expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, "i"));
      expect(sql).toContain(`'${table}'`);
    }
    expect(sql).toMatch(/policy_name := 'redeemer_' \|\| tbl \|\| '_block_all'/i);
    expect(sql).toMatch(/CREATE POLICY %I ON public\.%I AS RESTRICTIVE FOR ALL TO authenticated/i);
    expect(sql).toMatch(/public_label_state text NOT NULL DEFAULT 'not_on_twofer_yet'/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.public_local_businesses/i);
    expect(sql).toMatch(/aggregate_demand_count/i);
    expect(sql).toMatch(/COALESCE\(pd\.unique_users_count, 0\) >= 5/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.record_business_demand_signal/i);
    expect(sql).toMatch(/token_hash text NOT NULL UNIQUE/i);
    expect(sql).toMatch(/'business\.approve'[\s\S]*RETURN v_role IN \('admin', 'moderator'\);/i);
    expect(sql).toMatch(/'prospect\.import'[\s\S]*RETURN v_role IN \('admin', 'sales', 'moderator', 'developer'\);/i);
    expect(sql).not.toMatch(/INSERT INTO public\.deals/i);

    const adminAiSql = read("supabase/migrations/20260802130000_admin_ai_operating_layer.sql");
    expect(adminAiSql).toMatch(/ALTER COLUMN business_id DROP NOT NULL/i);
    expect(adminAiSql).toMatch(/ADD COLUMN IF NOT EXISTS admin_user_id/i);
    expect(adminAiSql).toMatch(/ADD COLUMN IF NOT EXISTS related_prospect_id/i);
    expect(adminAiSql).toMatch(/ADD COLUMN IF NOT EXISTS safe_for_public_display/i);
    expect(adminAiSql).toMatch(/CHECK \(tier IN \('A', 'B', 'C', 'Do Not Contact'\)\)/i);

    const promptSql = read("supabase/migrations/20260802140000_admin_ai_prompt_registry.sql");
    expect(promptSql).toMatch(/CREATE TABLE IF NOT EXISTS public\.admin_ai_prompts/i);
    expect(promptSql).toMatch(/ALTER TABLE public\.admin_ai_prompts ENABLE ROW LEVEL SECURITY/i);
    expect(promptSql).toMatch(/REVOKE ALL ON public\.admin_ai_prompts FROM anon, authenticated/i);
    expect(promptSql).toMatch(/admin_ai_prompts_active_feature_idx/i);
    expect(promptSql).toMatch(/admin-operating-report-v1/i);
  });

  it("registers prospect edge functions and keeps admin auth centralized", () => {
    const config = read("supabase/config.toml");
    for (const fn of [
      "public-local-businesses",
      "request-business-on-twofer",
      "admin-prospect-import",
      "admin-prospect-enrich",
      "admin-prospect-score",
      "admin-demand-proof",
      "admin-sales-script",
      "admin-onboarding-review-ai",
      "admin-prospect-sales",
      "admin-claim-link-create",
      "admin-claim-link-assistant",
      "business-claim-link",
      "admin-trial-create-from-prospect",
      "admin-trial-conversion-assistant",
      "admin-ai-operating-report",
      "admin-ai-prompts",
    ]) {
      expect(config).toMatch(new RegExp(`\\[functions\\.${fn}\\][\\s\\S]*verify_jwt\\s*=\\s*false[\\s\\S]*entrypoint\\s*=\\s*"\\.\\/functions\\/${fn}\\/index\\.ts"`));
    }

    const helper = read("supabase/functions/_shared/admin-prospects.ts");
    expect(helper).toMatch(/from\("admin_users"\)/);
    expect(helper).toMatch(/isRedeemerUser/);
    expect(helper).toMatch(/adminUser\.require_mfa && !isAal2/);
    expect(helper).toMatch(/admin_prospect_permission_denied/);
  });

  it("keeps public endpoints safe and demand capture authenticated", () => {
    const publicList = read("supabase/functions/public-local-businesses/index.ts");
    const demand = read("supabase/functions/request-business-on-twofer/index.ts");
    expect(publicList).toMatch(/rpc\("public_local_businesses"/);
    expect(publicList).not.toMatch(/serviceRoleKey|SUPABASE_SERVICE_ROLE_KEY/);
    expect(demand).toMatch(/auth\.getUser/);
    expect(demand).toMatch(/record_business_demand_signal/);
    expect(demand).toMatch(/Sign in to request this business/);
    expect(demand).not.toMatch(/from\("deals"\)\.insert|from\("businesses"\)\.insert/);
  });

  it("stores only claim token hashes and does not materialize businesses from clicks", () => {
    const adminClaim = read("supabase/functions/admin-claim-link-create/index.ts");
    const publicClaim = read("supabase/functions/business-claim-link/index.ts");
    expect(adminClaim).toMatch(/sha256Hex\(rawToken\)/);
    expect(adminClaim).toMatch(/token_hash: tokenHash/);
    expect(adminClaim).toMatch(/raw_token: rawToken/);
    expect(publicClaim).toMatch(/sha256Hex\(token\)/);
    expect(publicClaim).toMatch(/business_applications/);
    expect(publicClaim).toMatch(/createOnboardingRequest/);
    expect(publicClaim).not.toMatch(/materializeBusinessForUser|from\("businesses"\)\.insert|from\("deals"\)\.insert/);

    const claimAssistant = read("supabase/functions/admin-claim-link-assistant/index.ts");
    expect(claimAssistant).toMatch(/ai_must_not_create_token/);
    expect(claimAssistant).toMatch(/raw_tokens_never_logged/);
    expect(claimAssistant).not.toMatch(/randomUrlToken|raw_token:|token_hash:/);
  });

  it("adds existing-shell website routes, /admon redirect, and safe public copy", () => {
    const vercel = read("website/vercel.json");
    expect(vercel).toMatch(/"source": "\/admon"/);
    expect(vercel).toMatch(/"destination": "\/admin"/);
    expect(vercel).toMatch(/"source": "\/admin\/prospects"/);
    expect(vercel).toMatch(/"source": "\/business\/claim\/:token"/);

    for (const page of [
      "website/admin/prospects/index.html",
      "website/admin/prospects/import/index.html",
      "website/admin/prospects/detail/index.html",
      "website/admin/sales-ai/index.html",
      "website/admin/ai-operating-report/index.html",
      "website/admin/ai-prompts/index.html",
      "website/business/claim/index.html",
    ]) {
      expect(read(page)).toMatch(/Twofer/);
    }

    const websiteCopy = [
      read("website/index.html"),
      read("website/business/start-trial/index.html"),
      read("website/localization.js"),
      read("scripts/check-website-ui-crawl.js"),
    ].join("\n");
    expect(websiteCopy).not.toMatch(/BOGO|2-for-1|2 for 1|2x1/i);
  });

  it("keeps new prospect functions from creating live offers", () => {
    const combined = prospectFunctions.map(read).join("\n");
    expect(combined).not.toMatch(/from\("deals"\)\.insert|from\('deals'\)\.insert|INSERT INTO public\.deals/i);
    expect(combined).not.toMatch(/STRIPE_SECRET_KEY/);
  });

  it("routes admin AI through shared edge helpers and keeps mobile clean", () => {
    const helper = read("supabase/functions/_shared/admin-ai.ts");
    expect(helper).toMatch(/generateStructuredText/);
    expect(helper).toMatch(/logAiCost/);
    expect(helper).toMatch(/ai_generation_logs/);
    expect(helper).toMatch(/ADMIN_AI_PROMPT_VERSIONS/);
    expect(helper).toMatch(/admin_ai_prompts/);
    expect(helper).toMatch(/last_used_at/);
    expect(helper).toMatch(/safe_for_public_display/);
    expect(helper).toMatch(/requires_human_review/);

    for (const fn of [
      "supabase/functions/admin-prospect-enrich/index.ts",
      "supabase/functions/admin-prospect-score/index.ts",
      "supabase/functions/admin-demand-proof/index.ts",
      "supabase/functions/admin-sales-script/index.ts",
      "supabase/functions/admin-onboarding-review-ai/index.ts",
      "supabase/functions/admin-claim-link-assistant/index.ts",
      "supabase/functions/admin-trial-conversion-assistant/index.ts",
      "supabase/functions/admin-ai-operating-report/index.ts",
    ]) {
      const source = read(fn);
      expect(source, `${fn} must use the shared admin AI helper`).toMatch(/generateAdminAiJson/);
      expect(source, `${fn} must require admin auth`).toMatch(/requireAdmin/);
      expect(source, `${fn} must audit admin output`).toMatch(/audit\(ctx/);
      expect(source, `${fn} must not create live deals`).not.toMatch(/from\("deals"\)\.insert|INSERT INTO public\.deals/i);
    }

    const mobileSources = [
      ...["app", "lib", "components", "hooks"].map((dir) => readDirectoryText(dir)),
    ].join("\n");
    expect(mobileSources).not.toMatch(/admin-ai|admin-prospect-enrich|admin-prospect-score|admin-demand-proof|admin-sales-script|admin-claim-link-assistant|admin-trial-conversion-assistant/);
  });

  it("adds prompt registry UI and deployed-staging smoke coverage", () => {
    const promptFunction = read("supabase/functions/admin-ai-prompts/index.ts");
    expect(promptFunction).toMatch(/requireAdmin\(req, requestId, "prompt\.manage"\)/);
    expect(promptFunction).toMatch(/admin_ai_prompt_saved/);
    expect(promptFunction).toMatch(/admin_ai_prompt_activated/);
    expect(promptFunction).not.toMatch(/OPENAI_API_KEY|GEMINI_API_KEY|from\("deals"\)\.insert/);

    const page = read("website/admin/ai-prompts/index.html");
    const script = read("website/admin/ai-prompts.js");
    const vercel = read("website/vercel.json");
    expect(page).toMatch(/data-admin-ai-prompts-endpoint/);
    expect(script).toMatch(/adminAiPromptsEndpoint|promptsEndpoint/);
    expect(script).not.toMatch(/OPENAI_API_KEY|GEMINI_API_KEY/);
    expect(vercel).toMatch(/"source": "\/admin\/ai-prompts"/);

    const smoke = read("scripts/smoke-admin-ai-staging.mjs");
    expect(smoke).toMatch(/TWOFER_STAGING_SUPABASE_URL/);
    expect(smoke).toMatch(/Refusing to run staging admin AI e2e against the known production Supabase project/);
    expect(smoke).toMatch(/admin-ai-prompts/);
    expect(read("package.json")).toMatch(/smoke:admin-ai-staging/);
  });
});

function readDirectoryText(dir: string): string {
  const parts: string[] = [];
  for (const name of readdirSync(join(process.cwd(), dir))) {
    const path = join(process.cwd(), dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      parts.push(readDirectoryText(join(dir, name)));
    } else if (/\.(ts|tsx|js|jsx)$/.test(name)) {
      parts.push(readFileSync(path, "utf8"));
    }
  }
  return parts.join("\n");
}
