import { describe, expect, it } from "vitest";
import { extractDealPhotoStoragePath, resolveDealPosterDisplayUri } from "./deal-poster-url";

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
