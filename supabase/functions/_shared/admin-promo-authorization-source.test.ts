import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const source = read("supabase/functions/admin-promo-authorization/index.ts");

describe("admin-assisted promotional materials authorization", () => {
  it("registers the edge function", () => {
    const config = read("supabase/config.toml");
    expect(config).toMatch(
      /\[functions\.admin-promo-authorization\][\s\S]*entrypoint\s*=\s*"\.\/functions\/admin-promo-authorization\/index\.ts"/,
    );
  });

  it("gates on requireAdmin with a write-level permission", () => {
    expect(source).toMatch(/requireAdmin\(req, requestId, "sales\.write"\)/);
    expect(source).toMatch(/if \(ctx instanceof Response\) return ctx/);
    // requireAdmin itself enforces active admin + MFA aal2 + roleCan.
    const shared = read("supabase/functions/_shared/admin-prospects.ts");
    expect(shared).toMatch(/adminUser\.require_mfa && !isAal2\(bearerToken\)/);
    expect(shared).toMatch(/roleCan\(adminUser\.role, permission\)/);
  });

  // Required case 10: no admin path can record consent without naming the
  // person who gave it, their role, and when.
  it("requires authorizer identity, role, and the date permission was received", () => {
    expect(source).toMatch(/const authorizerName = cleanString\(payload\.authorizer_name, 120\)/);
    expect(source).toMatch(/const authorizerRole = cleanString\(payload\.authorizer_role, 60\)/);
    expect(source).toMatch(/const permissionReceivedAt = parseReceivedAt\(payload\.permission_received_at\)/);
    expect(source).toMatch(/if \(!authorizerName \|\| !authorizerRole \|\| !permissionReceivedAt\)/);
    // location_id is mandatory here: consent is per-location.
    expect(source).toMatch(/if \(!UUID_RE\.test\(locationId\)\)/);
    expect(source).toMatch(/location\.business_id !== businessId/);
  });

  it("stamps admin provenance on every row it writes", () => {
    expect(source).toMatch(/source: "admin_assisted"/);
    expect(source).toMatch(/recordedByAdminUserId: ctx\.adminUser\.id/);
    expect(source).toMatch(/permissionReceivedAt/);
  });

  it("writes an audit-log entry for both recording and revocation", () => {
    expect(source).toMatch(/audit\(ctx, \{[\s\S]*?action: "admin_promo_authorization_recorded"/);
    expect(source).toMatch(/audit\(ctx, \{[\s\S]*?action: "admin_promo_authorization_revoked"/);
    expect(source).toMatch(/targetType: "promo_materials_authorization"/);
    const shared = read("supabase/functions/_shared/admin-prospects.ts");
    expect(shared).toMatch(/from\("admin_audit_log"\)\.insert/);
  });

  it("never deletes an authorization row", () => {
    expect(source).not.toMatch(/\.delete\(\)/);
  });

  it("surfaces the on-behalf-of label wherever admin-recorded consent is shown", () => {
    const summary = read("supabase/functions/admin-dashboard-summary/index.ts");
    expect(summary).toMatch(/const ADMIN_ASSISTED_LABEL = "Recorded by Twofer on behalf of business"/);
    expect(summary).toMatch(/recorded_on_behalf_label: latest\?\.source === "admin_assisted" \? ADMIN_ASSISTED_LABEL : null/);

    const renderer = read("website/admin/admin-directory.js");
    expect(renderer).toMatch(/ADMIN_ASSISTED_LABEL = "Recorded by Twofer on behalf of business"/);
    expect(renderer).toMatch(/\[data-promo-materials\]/);

    const detail = read("website/admin/businesses/detail/index.html");
    expect(detail).toMatch(/data-promo-materials/);
    expect(detail).toMatch(/Recorded by Twofer on behalf of business/);
    expect(detail).toMatch(/data-promo-name/);
    expect(detail).toMatch(/data-promo-role/);
    expect(detail).toMatch(/data-promo-received/);
  });

  it("keeps the admin summary block read-only and non-gating", () => {
    const summary = read("supabase/functions/admin-dashboard-summary/index.ts");
    expect(summary).toMatch(/async function loadPromoMaterialsDetail/);
    // Degrades to an empty list rather than breaking the business detail view.
    expect(summary).toMatch(/\[admin-dashboard-summary\] promo materials detail error/);
    expect(summary).not.toMatch(/promo_materials_authorizations"\)[\s\S]{0,200}\.(insert|update|delete)\(/);
  });
});
