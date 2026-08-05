import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_AI_ENVELOPE_KEYS,
  ADMIN_AI_FEATURE_REQUIRED_KEYS,
  ADMIN_AI_V2_MAX_OUTPUT_TOKENS,
  ADMIN_AI_V2_REQUIRED_STRING_FIELDS,
  SCORE_COMPONENT_RANGES,
  SCORE_TOTAL_RANGE,
  TWOFER_TRIAL_FACTS,
  adminAiV2Enabled,
  bannedPhraseGuardrailSection,
  featureSystemPromptSection,
  findEmptyRequiredStringFields,
  findMissingRequiredKeysInSchema,
  isInternalOnlyFieldName,
  isPublicFacingFieldName,
  onboardingReviewPromptSection,
  prospectEnrichmentPromptSection,
  prospectScoringPromptSection,
  salesScriptPromptSection,
  type ScoreComponentRange,
} from "./admin-ai-v2.ts";
import type { AdminAiFeature } from "./admin-ai.ts";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const ALL_FEATURES: AdminAiFeature[] = [
  "prospect_enrichment",
  "prospect_scoring",
  "demand_proof",
  "sales_script",
  "onboarding_review",
  "claim_link_assistant",
  "trial_conversion_assistant",
  "owner_email",
  "operating_report",
];

describe("adminAiV2Enabled", () => {
  it("defaults false under node/vitest (no Deno global)", () => {
    expect(adminAiV2Enabled()).toBe(false);
  });
});

describe("bannedPhraseGuardrailSection", () => {
  it("names every banned term and offers merchant-safe replacements", () => {
    const section = bannedPhraseGuardrailSection();
    expect(section).toMatch(/BOGO/);
    expect(section).toMatch(/2-for-1/);
    expect(section).toMatch(/2 for 1/);
    expect(section).toMatch(/2x1/);
    expect(section).toMatch(/local offer/i);
    expect(section).toMatch(/limited-time offer/i);
  });
});

describe("featureSystemPromptSection", () => {
  it("returns the sales_script section with tone, word limits, an example pitch, and trial facts", () => {
    const section = featureSystemPromptSection("sales_script");
    expect(section).toBe(salesScriptPromptSection());
    expect(section).toMatch(/founder-led/);
    expect(section).toMatch(/direct/);
    expect(section).toMatch(/word/i);
    expect(section).toMatch(/Example 30-second pitch/);
    expect(section).toMatch(new RegExp(String(TWOFER_TRIAL_FACTS.trialDays)));
    expect(section).toMatch(new RegExp(String(TWOFER_TRIAL_FACTS.limited.offerLimit)));
    expect(section).toMatch(new RegExp(String(TWOFER_TRIAL_FACTS.limited.claimLimit)));
    expect(section).toMatch(new RegExp(String(TWOFER_TRIAL_FACTS.full.offerLimit)));
    expect(section).toMatch(new RegExp(String(TWOFER_TRIAL_FACTS.full.claimLimit)));
  });

  it("returns the onboarding_review section with decision criteria matching admin-onboarding-review-ai's fallback logic", () => {
    const section = featureSystemPromptSection("onboarding_review");
    expect(section).toBe(onboardingReviewPromptSection());
    expect(section).toMatch(/contact name/);
    expect(section).toMatch(/owner email/);
    expect(section).toMatch(/40/);
    expect(section).toMatch(/2/);
    expect(section).toMatch(/admin must click/i);

    // Cross-check against the live endpoint so the two never silently drift.
    const endpoint = read("supabase/functions/admin-onboarding-review-ai/index.ts");
    expect(endpoint).toMatch(/riskScore < 40/);
    expect(endpoint).toMatch(/missing\.length > 2/);
  });

  it("returns the prospect_enrichment section instructing grounded, unverified-by-default facts", () => {
    const section = featureSystemPromptSection("prospect_enrichment");
    expect(section).toBe(prospectEnrichmentPromptSection());
    expect(section).toMatch(/unverified/i);
    expect(section).toMatch(/supplied source content/i);
  });

  it("returns the prospect_scoring section with the full rubric", () => {
    const section = featureSystemPromptSection("prospect_scoring");
    expect(section).toBe(prospectScoringPromptSection());
    for (const [key, range] of Object.entries(SCORE_COMPONENT_RANGES)) {
      expect(section).toMatch(new RegExp(`${key}: ${range.min} to ${range.max}`));
    }
    expect(section).toMatch(/baseline_score/);
  });

  it("returns an empty section for every other feature", () => {
    for (const feature of ALL_FEATURES) {
      if (["sales_script", "onboarding_review", "prospect_enrichment", "prospect_scoring"].includes(feature)) continue;
      expect(featureSystemPromptSection(feature)).toBe("");
    }
  });
});

describe("SCORE_COMPONENT_RANGES", () => {
  it("matches the deterministic scorer in admin-prospect-score/index.ts", () => {
    const source = read("supabase/functions/admin-prospect-score/index.ts");
    // demand: Math.min(20, ...) of all-non-negative terms.
    expect(source).toMatch(/Math\.min\(20, input\.demand\.requests/);
    expect(SCORE_COMPONENT_RANGES.demand).toEqual({ min: 0, max: 20 });
    // categoryScore: 18 / 12 / 6.
    expect(source).toMatch(/return 18;/);
    expect(source).toMatch(/return 12;/);
    expect(source).toMatch(/return 6;/);
    expect(SCORE_COMPONENT_RANGES.category_fit).toEqual({ min: 6, max: 18 });
    // geographyScore: 16 / 10 / 4.
    expect(source).toMatch(/return 16;/);
    expect(source).toMatch(/return 10;/);
    expect(source).toMatch(/return 4;/);
    expect(SCORE_COMPONENT_RANGES.geography).toEqual({ min: 4, max: 16 });
    // businessType: 2 or 10.
    expect(source).toMatch(/chain\|franchise\|national.*\? 2 : 10/);
    expect(SCORE_COMPONENT_RANGES.business_type).toEqual({ min: 2, max: 10 });
    // slowPeriodFit: 10 or 5.
    expect(source).toMatch(/\? 10 : 5/);
    expect(SCORE_COMPONENT_RANGES.slow_period_fit).toEqual({ min: 5, max: 10 });
    // duplicateRisk: -35 or 0.
    expect(source).toMatch(/-35 : 0/);
    expect(SCORE_COMPONENT_RANGES.duplicate_risk).toEqual({ min: -35, max: 0 });
    // salesReadiness base 3/7/12 + reviewBonus 0/8.
    expect(source).toMatch(/\? 12 : 7\) : 3/);
    expect(source).toMatch(/review_status === "approved" \|\| input\.prospect\.review_status === "verified" \? 8 : 0/);
    expect(SCORE_COMPONENT_RANGES.sales_readiness).toEqual({ min: 3, max: 20 });
  });

  it("total score range matches clampScore's 0-100 clamp", () => {
    const source = read("supabase/functions/admin-prospect-score/index.ts");
    expect(source).toMatch(/Math\.max\(0, Math\.min\(100, Math\.round\(parsed\)\)\)/);
    expect(SCORE_TOTAL_RANGE).toEqual({ min: 0, max: 100 });
  });

  it("every range has min <= max", () => {
    const ranges: ScoreComponentRange[] = [...Object.values(SCORE_COMPONENT_RANGES), SCORE_TOTAL_RANGE];
    for (const range of ranges) {
      expect(range.min).toBeLessThanOrEqual(range.max);
    }
  });
});

describe("field classification", () => {
  it("treats known internal-only field names as not public-facing", () => {
    for (const name of ["warnings", "sources", "risk_notes", "internal_notes", "review_status", "score_components"]) {
      expect(isInternalOnlyFieldName(name)).toBe(true);
      expect(isPublicFacingFieldName(name)).toBe(false);
    }
  });

  it("treats copy-bearing field names as public-facing", () => {
    for (const name of [
      "in_person_30_second_pitch",
      "follow_up_email",
      "suggested_owner_onboarding_email",
      "short_business_summary",
    ]) {
      expect(isInternalOnlyFieldName(name)).toBe(false);
      expect(isPublicFacingFieldName(name)).toBe(true);
    }
  });

  it("treats a null/undefined field name as not public-facing (nothing to re-ask about)", () => {
    expect(isPublicFacingFieldName(null)).toBe(false);
    expect(isPublicFacingFieldName(undefined)).toBe(false);
  });
});

describe("ADMIN_AI_FEATURE_REQUIRED_KEYS", () => {
  it("covers every AdminAiFeature and never includes an envelope key", () => {
    for (const feature of ALL_FEATURES) {
      const keys = ADMIN_AI_FEATURE_REQUIRED_KEYS[feature];
      expect(keys, feature).toBeDefined();
      expect(keys.length, feature).toBeGreaterThan(0);
      for (const envelopeKey of ADMIN_AI_ENVELOPE_KEYS) {
        expect(keys, `${feature} should not require envelope key ${envelopeKey}`).not.toContain(envelopeKey);
      }
    }
  });

  it("matches each endpoint's own default schema required list", () => {
    const enrich = read("supabase/functions/admin-prospect-enrich/index.ts");
    for (const key of ADMIN_AI_FEATURE_REQUIRED_KEYS.prospect_enrichment) {
      expect(enrich).toContain(`"${key}"`);
    }
    const score = read("supabase/functions/admin-prospect-score/index.ts");
    for (const key of ADMIN_AI_FEATURE_REQUIRED_KEYS.prospect_scoring) {
      expect(score).toContain(`"${key}"`);
    }
    const sales = read("supabase/functions/admin-sales-script/index.ts");
    for (const key of ADMIN_AI_FEATURE_REQUIRED_KEYS.sales_script) {
      expect(sales).toContain(`"${key}"`);
    }
    const trial = read("supabase/functions/admin-trial-conversion-assistant/index.ts");
    for (const key of ADMIN_AI_FEATURE_REQUIRED_KEYS.trial_conversion_assistant) {
      expect(trial).toContain(`"${key}"`);
    }
    const prompts = read("supabase/functions/admin-ai-prompts/index.ts");
    // Sanity: the FEATURES set in admin-ai-prompts/index.ts must know about
    // every feature this map covers (guards a future feature name typo).
    for (const feature of ALL_FEATURES) {
      expect(prompts).toContain(`"${feature}"`);
    }
  });
});

describe("ADMIN_AI_V2_REQUIRED_STRING_FIELDS and ADMIN_AI_V2_MAX_OUTPUT_TOKENS", () => {
  it("only apply to sales_script and trial_conversion_assistant", () => {
    expect(Object.keys(ADMIN_AI_V2_REQUIRED_STRING_FIELDS).sort()).toEqual(
      ["sales_script", "trial_conversion_assistant"].sort(),
    );
    expect(ADMIN_AI_V2_MAX_OUTPUT_TOKENS).toEqual({
      sales_script: 2400,
      trial_conversion_assistant: 2400,
    });
  });

  it("every listed field is a subset of that feature's required keys", () => {
    for (const [feature, fields] of Object.entries(ADMIN_AI_V2_REQUIRED_STRING_FIELDS)) {
      const required = new Set(ADMIN_AI_FEATURE_REQUIRED_KEYS[feature as AdminAiFeature]);
      for (const field of fields ?? []) {
        expect(required.has(field), `${feature}.${field}`).toBe(true);
      }
    }
  });
});

describe("findEmptyRequiredStringFields", () => {
  it("flags missing and blank fields, ignores fields with real content", () => {
    const missing = findEmptyRequiredStringFields(
      { a: "hello", b: "", c: "   ", d: 5 as unknown as string },
      ["a", "b", "c", "d", "e"],
    );
    expect(missing.sort()).toEqual(["b", "c", "d", "e"].sort());
  });

  it("treats a null output as every field missing", () => {
    expect(findEmptyRequiredStringFields(null, ["a", "b"])).toEqual(["a", "b"]);
  });

  it("returns an empty list when every field is present and non-blank", () => {
    expect(findEmptyRequiredStringFields({ a: "x", b: "y" }, ["a", "b"])).toEqual([]);
  });
});

describe("findMissingRequiredKeysInSchema", () => {
  it("passes an empty/missing schema (use-the-default case) with no missing keys", () => {
    expect(findMissingRequiredKeysInSchema("sales_script", {})).toEqual([]);
    expect(findMissingRequiredKeysInSchema("sales_script", null)).toEqual([]);
    expect(findMissingRequiredKeysInSchema("sales_script", undefined)).toEqual([]);
  });

  it("flags a custom schema that drops a load-bearing key", () => {
    const missing = findMissingRequiredKeysInSchema("sales_script", {
      name: "custom",
      strict: true,
      schema: {
        type: "object",
        required: ["in_person_30_second_pitch", "demo_pitch"],
      },
    });
    expect(missing).toEqual(
      ADMIN_AI_FEATURE_REQUIRED_KEYS.sales_script.filter(
        (key) => !["in_person_30_second_pitch", "demo_pitch"].includes(key),
      ),
    );
  });

  it("passes a custom schema that keeps every load-bearing key (plus extras)", () => {
    const missing = findMissingRequiredKeysInSchema("owner_email", {
      name: "custom",
      strict: true,
      schema: { type: "object", required: ["subject", "body", "extra_field"] },
    });
    expect(missing).toEqual([]);
  });

  it("also accepts a flat {required:[...]} schema without a nested .schema wrapper", () => {
    const missing = findMissingRequiredKeysInSchema("owner_email", { required: ["subject", "body"] });
    expect(missing).toEqual([]);
  });
});
