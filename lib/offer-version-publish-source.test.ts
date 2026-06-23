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

    const newDealBranch = fullCreateSource.indexOf("const locTargets =");
    const versionedPublish = fullCreateSource.indexOf("const versionedResult = await publishOfferVersionedDeal", newDealBranch);

    expect(newDealBranch).toBeGreaterThan(-1);
    expect(versionedPublish).toBeGreaterThan(newDealBranch);
    expect(fullCreateSource).not.toMatch(/OFFER_VERSION_PUBLISH_ENABLED/);
    expect(fullCreateSource).not.toMatch(/insertDealsWithCompatibility/);
  });

  it("requires quick create publish to use offer versions", () => {
    const definitionBuilder = quickCreateSource.indexOf("const offerDefinitionForPublish = buildExpressOfferDefinition");
    const definitionGuard = quickCreateSource.indexOf("Missing offer definition for versioned publish.", definitionBuilder);
    const versionedPublish = quickCreateSource.indexOf("const versionedResult = await publishOfferVersionedDeal", definitionGuard);

    expect(definitionBuilder).toBeGreaterThan(-1);
    expect(definitionGuard).toBeGreaterThan(definitionBuilder);
    expect(versionedPublish).toBeGreaterThan(definitionGuard);
    expect(quickCreateSource).not.toMatch(/OFFER_VERSION_PUBLISH_ENABLED/);
    expect(quickCreateSource).not.toMatch(/insertDealWithCompatibility/);
  });
});
