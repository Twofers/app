import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "app", "create", "ai.tsx"), "utf8");

const publishDealIndex = source.indexOf("async function publishDeal()");
const publishDealBlock = source.slice(publishDealIndex);

/**
 * Regression cover for the 2026-08-03 report: a merchant regenerated the ad on a
 * LIVE deal, the editor preview showed the new creative, "Save changes" reported
 * success — and the deal kept its old poster forever. The edit branch wrote a
 * plain deals UPDATE, which cannot mint an offer version, and the customer poster
 * spec hangs off deals.offer_version_id.
 */
describe("AI create edit-mode creative revision", () => {
  it("finds the publish path", () => {
    expect(publishDealIndex).toBeGreaterThan(-1);
  });

  it("routes an edit that carries regenerated creative through the versioned publish endpoint", () => {
    expect(publishDealBlock).toMatch(/const revisingCreative =[\s\S]{0,200}generatedAd != null && offerDefinition != null/);
    expect(publishDealBlock).toMatch(/if \(revisingCreative\) \{[\s\S]{0,400}runVersionedPublish\(\[updateRow\], editingDealId\)/);
    expect(publishDealBlock).toMatch(/\.\.\.\(reviseDealId \? \{ deal_id: reviseDealId \} : \{\}\)/);
  });

  it("keeps the plain deals update for edits with no new creative", () => {
    // Schedule/copy-only edits must not re-version: nothing new to snapshot, and
    // the RPC would need an offer definition the legacy editor cannot always build.
    expect(publishDealBlock).toMatch(/\} else \{\s*\n\s*const updateResult = await updateDealWithCompatibility\(updateRow\);/);
  });

  it("builds the revision ad spec exactly like a create publish", () => {
    // One shared helper, so a revision can never publish a differently-built spec
    // than the create path — including the poster-spec fallback retry.
    const helperIndex = publishDealBlock.indexOf("const runVersionedPublish");
    expect(helperIndex).toBeGreaterThan(-1);
    const helperBlock = publishDealBlock.slice(helperIndex, publishDealBlock.indexOf("if (editingDealId) {", helperIndex));
    expect(helperBlock).toMatch(/buildOfferVersionPublishAdSpec/);
    expect(helperBlock).toMatch(/isPosterPublishSpecError\(publishErr\)/);
    expect(helperBlock).toMatch(/poster: undefined/);
  });

  it("applies the creative publish gates to revisions, not just creates", () => {
    // A revision replaces art on an already-live deal, so an unapproved or
    // QA-blocked preview must block the save instead of reporting success.
    expect(publishDealBlock).toMatch(/const publishingCreative = !editingDealId \|\| revisingCreative/);
    expect(publishDealBlock).toMatch(/if \(publishingCreative && generatedAd && composedExactPresentationApprovalEnabled\)/);
    expect(publishDealBlock).toMatch(/if \(publishingCreative && automaticLocalizationApprovalEnabled/);
    expect(publishDealBlock).toMatch(/if \(publishingCreative && composedCompositeQaEnabled/);
    expect(publishDealBlock).toMatch(/if \(publishingCreative && selectedComposedScreenshotQaRequired\)/);
    expect(publishDealBlock).toMatch(/if \(publishingCreative && composedCompositeQaForPublish\.decision === "block"\)/);
    expect(publishDealBlock).toMatch(/if \(publishingCreative && composedScreenshotQaRequiredForPublish\)/);
  });

  it("does not push-notify on a revision", () => {
    // notifyDealPublished stays in the create branch only: the audience was
    // already notified when the deal first published.
    const editBranchIndex = publishDealBlock.indexOf("if (editingDealId) {");
    const createBranchIndex = publishDealBlock.indexOf("const locTargets");
    expect(editBranchIndex).toBeGreaterThan(-1);
    expect(createBranchIndex).toBeGreaterThan(editBranchIndex);
    expect(publishDealBlock.slice(editBranchIndex, createBranchIndex)).not.toMatch(/notifyDealPublished/);
  });
});
