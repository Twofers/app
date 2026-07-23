import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("explicit business terms acceptance", () => {
  it("registers the accept-business-terms edge function", () => {
    const config = read("supabase/config.toml");
    expect(config).toMatch(
      /\[functions\.accept-business-terms\][\s\S]*entrypoint\s*=\s*"\.\/functions\/accept-business-terms\/index\.ts"/,
    );
  });

  it("only writes terms_acceptances for the authenticated owner or an active owner/manager member", () => {
    const source = read("supabase/functions/accept-business-terms/index.ts");
    expect(source).toMatch(/auth\.getUser\(\)/);
    expect(source).toMatch(/isRedeemerUser\(user\)/);
    expect(source).toMatch(/assertCanAccept/);
    expect(source).toMatch(/businessRow\.owner_id === userId/);
    expect(source).toMatch(/\["owner", "manager"\]\.includes/);
    expect(source).toMatch(/Forbidden\./);
  });

  it("upserts a single business_terms row per version/source and rechecks can_business_publish", () => {
    const source = read("supabase/functions/accept-business-terms/index.ts");
    expect(source).toMatch(/from\("terms_acceptances"\)\.upsert/);
    expect(source).toMatch(/document_type:\s*"business_terms"/);
    expect(source).toMatch(/onConflict:\s*"business_id,document_type,document_version,source"/);
    expect(source).toMatch(/user_id:\s*user\.id/);
    expect(source).toMatch(/rpc\("can_business_publish"/);
    expect(source).toMatch(/business_profile_revision_log/);
  });

  it("does not let any other endpoint silently create a terms_acceptances row without an explicit accepted flag", () => {
    const claimLink = read("supabase/functions/business-claim-link/index.ts");
    const trialCreate = read("supabase/functions/admin-trial-create-from-prospect/index.ts");
    // Both onboarding entry points start every claimed/admin-created business
    // with terms not accepted — they must never flip this to true themselves.
    expect(claimLink).toMatch(/termsAccepted:\s*false/);
    expect(trialCreate).toMatch(/termsAccepted:\s*false/);
    expect(claimLink).not.toMatch(/terms_acceptances/);
    expect(trialCreate).not.toMatch(/terms_acceptances/);

    const sync = read("supabase/functions/_shared/business-onboarding-sync.ts");
    // The only place a terms_acceptances row is written from a snapshot is
    // gated behind normalized.termsAccepted, which claim-link/admin-trial
    // always leave false — so these businesses reach `terms_required` and
    // must go through accept-business-terms explicitly.
    expect(sync).toMatch(/if \(normalized\.termsAccepted\) \{/);
  });

  it("exposes reason_code terms_required to the app via get-business-onboarding-context", () => {
    const context = read("supabase/functions/get-business-onboarding-context/index.ts");
    expect(context).toMatch(/get_business_capabilities/);
    expect(context).toMatch(/reason_code: typeof capabilities\.reason_code === "string" \? capabilities\.reason_code : publish\.reason \?\? "pending_verification"/);
  });

  it("wires an in-app terms gate that the owner must explicitly check and submit", () => {
    const gate = read("components/business-terms-gate.tsx");
    expect(gate).toMatch(/acceptBusinessTerms/);
    expect(gate).toMatch(/accessibilityRole="checkbox"/);
    expect(gate).toMatch(/disabled=\{!checked \|\| busy\}/);
    expect(gate).toMatch(/TERMS_OF_SERVICE_URL/);

    const createHub = read("app/(tabs)/create.tsx");
    expect(createHub).toMatch(/BusinessTermsGate/);
    expect(createHub).toMatch(/reasonCode === "terms_required"/);
    expect(createHub).toMatch(/onAccepted=\{\(\) => setTermsRequired\(false\)\}/);
  });

  it("adds a client helper that surfaces structured errors from accept-business-terms, without touching the locked AI ad client wrapper", () => {
    const lib = read("lib/business-terms.ts");
    expect(lib).toMatch(/export async function acceptBusinessTerms/);
    expect(lib).toMatch(/invoke\("accept-business-terms"/);
    expect(lib).toMatch(/throwInvokeError/);
    // lib/functions.ts is hash-locked as the AI ad-generation client wrapper
    // (docs/ai-poster-core-lock.json) — this feature must not require editing it.
    const functionsLib = read("lib/functions.ts");
    expect(functionsLib).not.toMatch(/acceptBusinessTerms/);
  });
});
