import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Finding 02 (money & trust audit): every deal_claims write must go through
// the service-role client so the client-side REVOKE (see
// lock-down-deal-claims-client-writes-migration.test.ts) can never be worked
// around by a customer self-redeeming or un-redeeming their own claim.
const FUNCTIONS_WITH_CLAIM_WRITES = [
  "begin-visual-redeem",
  "complete-visual-redeem",
  "release-claim",
  "redeem-token",
] as const;

function readFunctionSource(name: string): string {
  return readFileSync(join(process.cwd(), "supabase", "functions", name, "index.ts"), "utf8");
}

describe("deal_claims writes use the service-role client", () => {
  for (const name of FUNCTIONS_WITH_CLAIM_WRITES) {
    it(`${name} declares a service-role supabaseAdmin client`, () => {
      const source = readFunctionSource(name);
      expect(source).toMatch(/const supabaseAdmin = createClient\(supabaseUrl, supabaseServiceKey\)/);
    });

    it(`${name} routes every finalizeStaleVisualRedeemForClaim call through supabaseAdmin`, () => {
      const source = readFunctionSource(name);
      const finalizeCalls = source.match(/finalizeStaleVisualRedeemForClaim\([^,]+,/g) ?? [];
      // release-claim doesn't call finalizeStaleVisualRedeemForClaim at all; the
      // other three must call it, and every call must use supabaseAdmin.
      if (name !== "release-claim") {
        expect(finalizeCalls.length).toBeGreaterThan(0);
      }
      for (const call of finalizeCalls) {
        expect(call).toMatch(/finalizeStaleVisualRedeemForClaim\(supabaseAdmin,/);
      }
    });

    it(`${name} performs every deal_claims .update( through supabaseAdmin`, () => {
      const source = readFunctionSource(name);
      // Every `.from("deal_claims")` immediately followed (ignoring whitespace/
      // newlines) by `.update(` must be preceded by `supabaseAdmin` as the
      // client the chain started from, not the bare `supabase` user client.
      const updateChainStarts = [
        ...source.matchAll(/(\w+)\s*\n?\s*\.from\("deal_claims"\)\s*\n?\s*\.update\(/g),
      ];
      expect(updateChainStarts.length).toBeGreaterThan(0);
      for (const match of updateChainStarts) {
        expect(match[1]).toBe("supabaseAdmin");
      }
    });
  }

  it("claim-deal already inserts deal_claims via supabaseAdmin (unchanged baseline)", () => {
    const source = readFunctionSource("claim-deal");
    const insertChainStarts = [
      ...source.matchAll(/(\w+)\s*\n?\s*\.from\("deal_claims"\)\s*\n?\s*\.insert\(/g),
    ];
    expect(insertChainStarts.length).toBeGreaterThan(0);
    for (const match of insertChainStarts) {
      expect(match[1]).toBe("supabaseAdmin");
    }
  });
});
