import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const fullCreateSource = readFileSync(join(process.cwd(), "app", "create", "ai.tsx"), "utf8");
const quickCreateSource = readFileSync(join(process.cwd(), "app", "create", "quick.tsx"), "utf8");

describe("offer version publish source guards", () => {
  it("requires full AI create new-deal publish to use offer versions", () => {
    expect(fullCreateSource).toMatch(/!editingDealId && !offerDefinition/);
    expect(fullCreateSource).toMatch(/publishOfferVersionedDeal/);
    expect(fullCreateSource).toMatch(/buildOfferVersionPublishAdSpec\(\s*"create_ai"/);
    expect(fullCreateSource).toMatch(/selectedComposedPresentationHash/);
    expect(fullCreateSource).toMatch(/approvedComposedPresentationHash/);
    expect(fullCreateSource).toMatch(/runDeterministicAdCompositeQa/);
    expect(fullCreateSource).toMatch(/buildComposedScreenshotQaSnapshot/);
    expect(fullCreateSource).toMatch(/composedCardPublishSpec/);
    expect(fullCreateSource).toMatch(/composedCard: composedCardPublishSpec/);
    expect(fullCreateSource).toMatch(/errPresentationApprovalRequired/);
    expect(fullCreateSource).toMatch(/invalidateAcceptedAdDraft/);

    const newDealBranch = fullCreateSource.indexOf("const locTargets =");
    const versionedPublish = fullCreateSource.indexOf("publishOfferVersionedDeal", newDealBranch);

    expect(newDealBranch).toBeGreaterThan(-1);
    expect(versionedPublish).toBeGreaterThan(newDealBranch);
    expect(fullCreateSource).not.toMatch(/OFFER_VERSION_PUBLISH_ENABLED/);
    expect(fullCreateSource).not.toMatch(/insertDealsWithCompatibility/);
  });

  it("never echoes an unrecognized publish error to the merchant", () => {
    const detail = fullCreateSource.indexOf("function publishErrorDetail");
    expect(detail).toBeGreaterThan(-1);
    const body = fullCreateSource.slice(detail, fullCreateSource.indexOf("function publishReasonCodes"));

    // A merchant once saw "Couldn't publish this deal. Could not load bundle"
    // because the tail of publishErrorDetail echoed any unmatched message. The
    // raw passthrough must stay behind a structured error_code check, and the
    // check must come before the text is cleaned and returned.
    expect(body).toMatch(/if \(!code\) return null;/);
    expect(body.indexOf("if (!code) return null;")).toBeLessThan(body.indexOf("const cleaned = raw"));
    expect(body).toMatch(/PUBLISH_SERVICE_UNAVAILABLE_CODE/);
    expect(body).toMatch(/isEdgeRuntimeFailureMessage\(raw\)/);
    expect(body).toMatch(/errPublishServiceUnavailable/);
  });

  it("keeps quick create as a redirect into the unified AI builder", () => {
    expect(quickCreateSource).toMatch(/pathname: "\/create\/ai"/);
    expect(quickCreateSource).toMatch(/fromCreateHub = "1"/);
    expect(quickCreateSource).not.toMatch(/publishOfferVersionedDeal/);
    expect(quickCreateSource).not.toMatch(/buildOfferVersionPublishAdSpec\("create_quick"/);
  });
});
