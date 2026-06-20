import { describe, expect, it } from "vitest";

import {
  buildMediaApprovalDecisions,
  groupBrandPhotoLibraryCandidates,
  resolveWebsiteDiscoveryIntent,
  validateBrandPhotoLibrarySetup,
  type BrandPhotoLibraryCandidate,
} from "./brand-photo-library-setup";

const candidates: BrandPhotoLibraryCandidate[] = [
  {
    id: "web-hero",
    sourceType: "website_import",
    uri: "https://example.com/hero.jpg",
    moderationStatus: "approved",
  },
  {
    id: "ig-latte",
    sourceType: "instagram_import",
    uri: "https://cdn.example.com/ig-latte.jpg",
    moderationStatus: "pending",
  },
  {
    id: "upload-logo",
    sourceType: "owner_upload",
    uri: "file:///logo.png",
    moderationStatus: "approved",
  },
];

describe("brand photo library setup", () => {
  it("allows setup to be skipped without media", () => {
    expect(
      validateBrandPhotoLibrarySetup({
        websiteUrl: "",
        skipForNow: true,
        selectedCandidateIds: [],
        rightsConfirmed: false,
      }),
    ).toMatchObject({
      ok: true,
      completionMode: "skip",
      websiteDiscovery: { ok: true, shouldStartDiscovery: false },
    });
  });

  it("normalizes valid website URLs into a discovery intent", () => {
    expect(resolveWebsiteDiscoveryIntent(" cedarbean.example/photos#menu ")).toEqual({
      ok: true,
      shouldStartDiscovery: true,
      url: "https://cedarbean.example/photos",
      origin: "https://cedarbean.example",
      hostname: "cedarbean.example",
    });

    expect(
      validateBrandPhotoLibrarySetup({
        websiteUrl: "cedarbean.example/photos",
        skipForNow: false,
        selectedCandidateIds: [],
        rightsConfirmed: false,
      }),
    ).toMatchObject({ ok: true, completionMode: "start_website_discovery" });
  });

  it("rejects unsafe website URLs before discovery can start", () => {
    expect(
      validateBrandPhotoLibrarySetup({
        websiteUrl: "http://127.0.0.1:3000/photos",
        skipForNow: false,
        selectedCandidateIds: [],
        rightsConfirmed: false,
      }),
    ).toMatchObject({
      ok: false,
      reason: "INVALID_WEBSITE_URL",
      websiteDiscovery: { ok: false, reason: "UNSUPPORTED_PORT" },
    });
  });

  it("requires rights confirmation before selected candidates are approved", () => {
    expect(buildMediaApprovalDecisions(candidates, ["web-hero"], false)).toEqual({
      ok: false,
      reason: "RIGHTS_CONFIRMATION_REQUIRED",
    });

    expect(
      validateBrandPhotoLibrarySetup({
        websiteUrl: "",
        skipForNow: false,
        selectedCandidateIds: ["web-hero"],
        rightsConfirmed: false,
      }),
    ).toMatchObject({ ok: false, reason: "RIGHTS_CONFIRMATION_REQUIRED" });
  });

  it("marks selected media auto-usable only after approval, rights, and moderation", () => {
    const result = buildMediaApprovalDecisions(candidates, ["web-hero", "ig-latte"], true);

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected approval decisions");

    expect(result.decisions).toContainEqual({
      candidateId: "web-hero",
      sourceType: "website_import",
      sourceBadge: "Website",
      ownerApproved: true,
      rightsConfirmed: true,
      approvalStatus: "approved",
      autoUseEligible: true,
    });
    expect(result.decisions).toContainEqual({
      candidateId: "ig-latte",
      sourceType: "instagram_import",
      sourceBadge: "Instagram",
      ownerApproved: true,
      rightsConfirmed: true,
      approvalStatus: "approved",
      autoUseEligible: false,
    });
    expect(result.decisions).toContainEqual({
      candidateId: "upload-logo",
      sourceType: "owner_upload",
      sourceBadge: "Your photo",
      ownerApproved: false,
      rightsConfirmed: false,
      approvalStatus: "rejected",
      autoUseEligible: false,
    });
  });

  it("groups approval-gallery candidates by source in UI order", () => {
    expect(groupBrandPhotoLibraryCandidates(candidates)).toEqual([
      {
        sourceType: "owner_upload",
        badge: "Your photo",
        candidates: [candidates[2]],
      },
      {
        sourceType: "website_import",
        badge: "Website",
        candidates: [candidates[0]],
      },
      {
        sourceType: "instagram_import",
        badge: "Instagram",
        candidates: [candidates[1]],
      },
    ]);
  });

  it("rejects approvals for unknown candidate ids", () => {
    expect(buildMediaApprovalDecisions(candidates, ["missing-id"], true)).toEqual({
      ok: false,
      reason: "UNKNOWN_CANDIDATE",
      unknownCandidateIds: ["missing-id"],
    });
  });
});
