import { describe, expect, it } from "vitest";
import {
  extractDealPhotoStoragePath,
  resolveCurrentDealPosterStoragePath,
  resolveDealPosterDisplayUri,
} from "./deal-poster-url";

describe("extractDealPhotoStoragePath", () => {
  it("parses signed URL path", () => {
    const u =
      "https://abc.supabase.co/storage/v1/object/sign/deal-photos/biz-1/photo.jpg?token=xyz&other=1";
    expect(extractDealPhotoStoragePath(u)).toBe("biz-1/photo.jpg");
  });

  it("parses public URL path", () => {
    const u = "https://abc.supabase.co/storage/v1/object/public/deal-photos/biz-1/photo.jpg";
    expect(extractDealPhotoStoragePath(u)).toBe("biz-1/photo.jpg");
  });

  it("accepts bare storage path", () => {
    expect(extractDealPhotoStoragePath("owner/uuid/file.jpg")).toBe("owner/uuid/file.jpg");
  });

  it("returns null for empty or external unrelated URL", () => {
    expect(extractDealPhotoStoragePath(null)).toBe(null);
    expect(extractDealPhotoStoragePath("https://example.com/x.jpg")).toBe(null);
  });
});

describe("resolveDealPosterDisplayUri", () => {
  it("uses EXPO_PUBLIC_SUPABASE_URL for public URL", () => {
    const prev = process.env.EXPO_PUBLIC_SUPABASE_URL;
    process.env.EXPO_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
    expect(resolveDealPosterDisplayUri(null, "a/b.jpg")).toBe(
      "https://proj.supabase.co/storage/v1/object/public/deal-photos/a/b.jpg",
    );
    process.env.EXPO_PUBLIC_SUPABASE_URL = prev;
  });

  it("falls back to external http URL", () => {
    expect(resolveDealPosterDisplayUri("https://images.example.com/x.png", null)).toBe(
      "https://images.example.com/x.png",
    );
  });
});

describe("resolveCurrentDealPosterStoragePath", () => {
  it("prefers revised AI poster over the uploaded source photo", () => {
    expect(
      resolveCurrentDealPosterStoragePath({
        aiPosterStoragePath: "biz-1/ai_ad_enhanced_studiopolish.png",
        uploadedPhotoStoragePath: "biz-1/original-photo.jpg",
        posterUrl: null,
      }),
    ).toBe("biz-1/ai_ad_enhanced_studiopolish.png");
  });

  it("falls back to uploaded photo, then legacy poster URL", () => {
    expect(
      resolveCurrentDealPosterStoragePath({
        aiPosterStoragePath: null,
        uploadedPhotoStoragePath: "biz-1/original-photo.jpg",
        posterUrl: null,
      }),
    ).toBe("biz-1/original-photo.jpg");

    expect(
      resolveCurrentDealPosterStoragePath({
        aiPosterStoragePath: null,
        uploadedPhotoStoragePath: null,
        posterUrl: "https://abc.supabase.co/storage/v1/object/public/deal-photos/biz-1/template.jpg",
      }),
    ).toBe("biz-1/template.jpg");
  });

  it("does not use uploaded or legacy photo fallback when disabled", () => {
    expect(
      resolveCurrentDealPosterStoragePath({
        aiPosterStoragePath: null,
        uploadedPhotoStoragePath: "biz-1/reference-photo.jpg",
        posterUrl: "https://abc.supabase.co/storage/v1/object/public/deal-photos/biz-1/reference-photo.jpg",
        allowPhotoFallback: false,
      }),
    ).toBeNull();
  });

  it("still prefers an AI poster when photo fallback is disabled", () => {
    expect(
      resolveCurrentDealPosterStoragePath({
        aiPosterStoragePath: "biz-1/generated.jpg",
        uploadedPhotoStoragePath: "biz-1/reference-photo.jpg",
        allowPhotoFallback: false,
      }),
    ).toBe("biz-1/generated.jpg");
  });
});
