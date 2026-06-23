import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const fullCreateSource = readFileSync(join(process.cwd(), "app", "create", "ai.tsx"), "utf8");
const quickCreateSource = readFileSync(join(process.cwd(), "app", "create", "quick.tsx"), "utf8");

describe("offer version publish source guards", () => {
  it("requires full AI create new-deal publish to use offer versions", () => {
    expect(fullCreateSource).toMatch(/!editingDealId && !offerDefinition/);
    expect(fullCreateSource).toMatch(/publishOfferVersionedDeal/);
    expect(fullCreateSource).toMatch(/buildOfferVersionPublishAdSpec\("create_ai"/);
    expect(fullCreateSource).toMatch(/selectedComposedPresentationHash/);
    expect(fullCreateSource).toMatch(/approvedComposedPresentationHash/);
    expect(fullCreateSource).toMatch(/runDeterministicAdCompositeQa/);
    expect(fullCreateSource).toMatch(/composedCardPublishSpec/);
    expect(fullCreateSource).toMatch(/composedCard: composedCardPublishSpec/);
    expect(fullCreateSource).toMatch(/errPresentationApprovalRequired/);
    expect(fullCreateSource).toMatch(/invalidateAcceptedAdDraft/);

    const newDealBranch = fullCreateSource.indexOf("const locTargets =");
    const versionedPublish = fullCreateSource.indexOf("const versionedResult = await publishOfferVersionedDeal", newDealBranch);

    expect(newDealBranch).toBeGreaterThan(-1);
    expect(versionedPublish).toBeGreaterThan(newDealBranch);
    expect(fullCreateSource).not.toMatch(/OFFER_VERSION_PUBLISH_ENABLED/);
    expect(fullCreateSource).not.toMatch(/insertDealsWithCompatibility/);
  });

  it("keeps quick create as a redirect into the unified AI builder", () => {
    expect(quickCreateSource).toMatch(/pathname: "\/create\/ai"/);
    expect(quickCreateSource).toMatch(/fromCreateHub = "1"/);
    expect(quickCreateSource).not.toMatch(/publishOfferVersionedDeal/);
    expect(quickCreateSource).not.toMatch(/buildOfferVersionPublishAdSpec\("create_quick"/);
  });
});
