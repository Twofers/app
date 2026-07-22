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

  it("requires active AI and credit capabilities before quota, credits, logs, or provider work", () => {
    const ownershipIndex = source.indexOf("Ownership check");
    const businessNameIndex = source.indexOf("const businessName", ownershipIndex);
    const capabilityIndex = source.indexOf("await getBusinessCapabilities", businessNameIndex);
    const quotaStatusIndex = source.indexOf("if (quotaStatusOnly)", capabilityIndex);
    const quotaFetchIndex = source.indexOf("await fetchAdQuota", capabilityIndex);
    const creditReservationIndex = source.indexOf("reserveChargeableImageRevisionCredit", capabilityIndex);
    const openAiKeyCheckIndex = source.indexOf("if (!openAiKey)", capabilityIndex);
    const researchIndex = source.indexOf('research = await timeStage("research"', capabilityIndex);

    expect(source).toMatch(/import \{ getBusinessCapabilities \} from "\.\.\/_shared\/business-capabilities\.ts"/);
    expect(capabilityIndex).toBeGreaterThan(businessNameIndex);
    expect(source.slice(capabilityIndex, quotaStatusIndex)).toMatch(/can_generate_ai/);
    expect(source.slice(capabilityIndex, quotaStatusIndex)).toMatch(/can_consume_offer_credits/);
    expect(source.slice(capabilityIndex, quotaStatusIndex)).toMatch(/BUSINESS_AI_CAPABILITY_REQUIRED/);
    expect(source.slice(capabilityIndex, quotaStatusIndex)).toMatch(/BUSINESS_OFFER_CREDIT_CAPABILITY_REQUIRED/);
    expect(quotaFetchIndex).toBeGreaterThan(capabilityIndex);
    expect(creditReservationIndex).toBeGreaterThan(capabilityIndex);
    expect(openAiKeyCheckIndex).toBeGreaterThan(capabilityIndex);
    expect(researchIndex).toBeGreaterThan(capabilityIndex);
    expect(source.slice(researchIndex, researchIndex + 260)).toMatch(/researchMenuItem/);
  });
});
