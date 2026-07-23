import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("promotional materials authorization (owner path)", () => {
  it("registers the edge function", () => {
    const config = read("supabase/config.toml");
    expect(config).toMatch(
      /\[functions\.set-promo-materials-authorization\][\s\S]*entrypoint\s*=\s*"\.\/functions\/set-promo-materials-authorization\/index\.ts"/,
    );
  });

  // Required case 5: only the owner or an active owner/manager may act.
  it("authorizes only the owner or an active owner/manager, and rejects redeemer sessions", () => {
    const source = read("supabase/functions/set-promo-materials-authorization/index.ts");
    expect(source).toMatch(/auth\.getUser\(\)/);
    expect(source).toMatch(/isRedeemerUser\(user\)/);
    expect(source).toMatch(/forbiddenForRedeemerResponse/);
    expect(source).toMatch(/businessRow\.owner_id === userId/);
    expect(source).toMatch(/\["owner", "manager"\]\.includes\(role\)/);
    expect(source).toMatch(/memberRow\?\.status !== "active"/);
    expect(source).toMatch(/Forbidden\./);
  });

  // Required case 6/7: revoke flips status and preserves the row.
  it("revokes by stamping revoked_at and never deletes", () => {
    const helper = read("supabase/functions/_shared/promo-materials.ts");
    expect(helper).toMatch(/export async function revokeAuthorization/);
    expect(helper).toMatch(/revoked_at: new Date\(\)\.toISOString\(\)/);
    expect(helper).toMatch(/revoked_by_user_id/);
    expect(helper).not.toMatch(/\.delete\(\)/);

    const source = read("supabase/functions/set-promo-materials-authorization/index.ts");
    expect(source).not.toMatch(/\.delete\(\)/);
  });

  it("is idempotent on re-authorize and stamps the shared terms version", () => {
    const helper = read("supabase/functions/_shared/promo-materials.ts");
    expect(helper).toMatch(/const active = await findActiveAuthorization\(supabase, args\.locationId\);\s*\n\s*if \(active\) return active;/);
    // Required case 11: the version recorded is always the shared constant.
    expect(helper).toMatch(/import \{ CURRENT_BUSINESS_TERMS_VERSION \} from "\.\/business-terms-version\.ts"/);
    expect(helper).toMatch(/business_terms_version: CURRENT_BUSINESS_TERMS_VERSION/);
  });

  it("never lets an app client claim the admin or website source", () => {
    const helper = read("supabase/functions/_shared/promo-materials.ts");
    expect(helper).toMatch(
      /export const CLIENT_PROMO_SOURCES: PromoAuthorizationSource\[\] = \["app_onboarding", "app_settings"\]/,
    );
    const source = read("supabase/functions/set-promo-materials-authorization/index.ts");
    expect(source).toMatch(/isClientPromoSource\(body\.source\) \? body\.source : "app_settings"/);
    expect(source).not.toMatch(/"admin_assisted"/);
  });

  it("resolves or creates the primary location rather than guessing across many", () => {
    const helper = read("supabase/functions/_shared/promo-materials.ts");
    expect(helper).toMatch(/export async function resolvePrimaryLocationId/);
    expect(helper).toMatch(/row\.business_id !== businessId/);
    expect(helper).toMatch(/if \(rows\.length === 1\) return \{ ok: true, locationId: rows\[0\]\.id \}/);
    expect(helper).toMatch(/location_id is required/);
    expect(helper).toMatch(/from\("business_locations"\)\s*\n?\s*\.insert/);
  });

  // Required case 9: the feature is isolated from every gate.
  it("does not touch the publish gate, capabilities, billing, trial, or verification", () => {
    const source = read("supabase/functions/set-promo-materials-authorization/index.ts");
    expect(source).not.toMatch(/can_business_publish|get_business_capabilities/);
    expect(source).not.toMatch(/stripe|billing|trial|verification_status/i);
  });

  // Required case 3: accepting the terms alone must never grant placement.
  it("keeps terms acceptance free of any implicit promotional authorization", () => {
    const acceptTerms = read("supabase/functions/accept-business-terms/index.ts");
    expect(acceptTerms).not.toMatch(/promo_materials/i);

    const gate = read("components/business-terms-gate.tsx");
    expect(gate).not.toMatch(/promo/i);

    // The sync writes a consent row only behind its own explicit flag, which is
    // separate from normalized.termsAccepted. This path is currently unreachable
    // (see the NOTE in business-onboarding-sync.ts) — asserted for separation of
    // the two consents, NOT as evidence that website intake grants placement.
    const sync = read("supabase/functions/_shared/business-onboarding-sync.ts");
    expect(sync).toMatch(/if \(normalized\.promoMaterialsAuthorized === true\) \{/);
    expect(sync).toMatch(/source: "website_onboarding"/);
  });

  // Required case 1: the website flag is optional and defaults to false.
  it("treats the website intake flag as optional and defaulting to false", () => {
    const submit = read("supabase/functions/submit-business-application/index.ts");
    expect(submit).toMatch(/const promoMaterialsAuthorized = payload\.promo_materials_authorized === true/);
    expect(submit).toMatch(/promo_materials_authorized: promoMaterialsAuthorized/);
    // Must NOT be part of the required-fields guard.
    expect(submit).toMatch(
      /if \(!businessName \|\| !contactName \|\| !email \|\| !termsAccepted \|\| !privacyAcknowledged\) \{/,
    );

    const form = read("website/business/start-trial/index.html");
    expect(form).toMatch(/name="promo_materials_authorized" type="checkbox"/);
    // Never required, never pre-checked.
    expect(form).not.toMatch(/name="promo_materials_authorized"[^>]*(required|checked)/);
    expect(form).toMatch(/payload\.promo_materials_authorized = data\.get\("promo_materials_authorized"\) === "on"/);
  });

  it("adds a client helper outside the hash-locked AI wrapper", () => {
    const lib = read("lib/promo-materials.ts");
    expect(lib).toMatch(/export async function setPromoMaterialsAuthorization/);
    expect(lib).toMatch(/export async function getPromoMaterialsAuthorization/);
    expect(lib).toMatch(/invoke\("set-promo-materials-authorization"/);
    // lib/functions.ts is hash-locked (docs/ai-poster-core-lock.json).
    const functionsLib = read("lib/functions.ts");
    expect(functionsLib).not.toMatch(/PromoMaterials/);
  });
});

describe("promotional materials UI defaults", () => {
  // Required cases 1 and 2: unchecked by default, never blocks onboarding, and
  // never rendered together with the required terms acceptance.
  it("keeps the onboarding checkbox optional, unchecked, and non-blocking", () => {
    const setup = read("app/business-setup.tsx");
    expect(setup).toMatch(/const \[promoAuthChecked, setPromoAuthChecked\] = useState\(false\)/);
    expect(setup).toMatch(/accessibilityState=\{\{ checked: promoAuthChecked \}\}/);
    expect(setup).toMatch(/businessSetup\.promoAuthOptionalLabel/);
    expect(setup).toMatch(/businessSetup\.promoAuthCheckbox/);
    // Submit is gated only on busy/upload (loading is handled by an earlier
    // return) — never on the promo checkbox.
    expect(setup).toMatch(/disabled=\{busy \|\| logoUploading\}/);
    expect(setup).not.toMatch(/disabled=\{[^}]*promoAuthChecked/);
    // A failure records a soft notice instead of failing the save.
    expect(setup).toMatch(/async function applyPromoAuthorization[\s\S]*?catch[\s\S]*?return false/);
    expect(setup).toMatch(/businessSetup\.promoAuthDeferred/);
  });

  it("uses the branded confirm and the removal notice when revoking from account settings", () => {
    const account = read("app/(tabs)/account/index.tsx");
    expect(account).toMatch(/account\.promoAuthTitle/);
    expect(account).toMatch(/account\.promoAuthStatusOn/);
    expect(account).toMatch(/account\.promoAuthStatusOff/);
    expect(account).toMatch(/confirm\(\{[\s\S]*?account\.promoAuthRevokeConfirm/);
    // Repo convention: branded confirm, never Alert.alert.
    expect(account).not.toMatch(/Alert\.alert\([^)]*promoAuth/);
    // Feature-detect: the row hides when the table isn't readable yet.
    expect(account).toMatch(/setPromoAuth\(status \? status\.authorized : null\)/);
    expect(account).toMatch(/\{promoAuth !== null \? \(/);

    const en = JSON.parse(read("lib/i18n/locales/en.json"));
    expect(en.account.promoAuthRevokeConfirm).toMatch(/remove any existing Twofer promotional materials/i);
  });

  // Required case 12: app and website present the same authorization sentence.
  it("uses identical English checkbox copy in the app and on the website", () => {
    const en = JSON.parse(read("lib/i18n/locales/en.json"));
    const localization = read("website/localization.js");
    const match = localization.match(/"trial\.promoMaterialsCheckbox": "([^"]+)"/);
    expect(match).not.toBeNull();
    expect(en.businessSetup.promoAuthCheckbox).toBe(match?.[1]);
  });

  it("ships the Promotional Materials terms section with the separate-consent clarification", () => {
    const terms = read("website/business-terms/index.html");
    expect(terms).toMatch(/data-i18n="businessTerms\.promoMaterialsTitle"/);
    expect(terms).toMatch(/data-i18n="businessTerms\.promoMaterialsBody"/);
    expect(terms).toMatch(/data-i18n="businessTerms\.promoMaterialsOptIn"/);

    const localization = read("website/localization.js");
    // EN, ES and KO must all carry the new keys.
    expect(localization.match(/"businessTerms\.promoMaterialsBody":/g)).toHaveLength(3);
    expect(localization.match(/"businessTerms\.promoMaterialsOptIn":/g)).toHaveLength(3);
    expect(localization).toMatch(/accepting these Business Terms does not itself\s*\\?n?\s*authorize placement/);

    // The consumer ToS is untouched.
    const consumerTerms = read("website/terms/index.html");
    expect(consumerTerms).not.toMatch(/promotional materials/i);
  });
});
