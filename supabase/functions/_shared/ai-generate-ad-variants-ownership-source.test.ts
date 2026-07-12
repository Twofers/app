import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-generate-ad-variants", "index.ts"),
  "utf8",
);

describe("ai-generate-ad-variants ownership source guard", () => {
  it("authenticates the caller but reads the business owner row with the admin client", () => {
    const authIndex = source.indexOf("await userClient.auth.getUser()");
    const ownershipIndex = source.indexOf("Ownership check");
    const ownershipEnd = source.indexOf("const businessName", ownershipIndex);
    const ownershipBlock = source.slice(ownershipIndex, ownershipEnd);

    expect(authIndex).toBeGreaterThan(-1);
    expect(ownershipIndex).toBeGreaterThan(authIndex);
    expect(ownershipBlock).toMatch(/await admin\s*\n\s*\.from\("businesses"\)/);
    expect(ownershipBlock).not.toMatch(/await userClient\s*\n\s*\.from\("businesses"\)/);
    expect(ownershipBlock).toMatch(/business\.owner_id !== user\.id/);
    expect(ownershipBlock).toMatch(/You do not own this business/);
  });
});
