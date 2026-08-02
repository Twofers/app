import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("released claims free deal inventory", () => {
  const migration = read("supabase/migrations/20260824151000_released_claims_free_inventory.sql");
  const claimDeal = read("supabase/functions/claim-deal/index.ts");

  it("excludes canceled and released claims at every cap-counting site", () => {
    const excludedByDatabase = /claim_status NOT IN \('canceled', 'released'\)/g;
    expect(migration.match(excludedByDatabase)).toHaveLength(2);

    const excludedByEdgeFunction = /\.not\("claim_status", "in", "\(canceled,released\)"\)/g;
    expect(claimDeal.match(excludedByEdgeFunction)).toHaveLength(2);
  });

  it("keeps the trigger as the authoritative serialized cap gate", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.enforce_deal_max_claims\(\)/);
    expect(migration).toMatch(/FOR UPDATE/);
    expect(migration).toMatch(/RAISE EXCEPTION 'MAX_CLAIMS_REACHED'/);
  });
});
