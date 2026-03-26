/**
 * Deal posters are stored in Supabase Storage (`deal-photos`). Legacy rows often store a short-lived
 * signed URL in `poster_url`, which breaks the feed after expiry. Prefer resolving a stable path to
 * the public object URL (bucket is public-read for active deal art).
 */

const BUCKET = "deal-photos";

export function extractDealPhotoStoragePath(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) {
    if (s.includes("..") || s.startsWith("/")) return null;
    return s;
  }
  try {
    const u = new URL(s);
    const pathname = u.pathname;
    const publicMarker = "/object/public/deal-photos/";
    const signMarker = "/object/sign/deal-photos/";
    const pi = pathname.indexOf(publicMarker);
    if (pi !== -1) {
      return decodeURIComponent(pathname.slice(pi + publicMarker.length));
    }
    const si = pathname.indexOf(signMarker);
    if (si !== -1) {
      return decodeURIComponent(pathname.slice(si + signMarker.length));
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function buildPublicDealPhotoUrl(storagePath: string): string | null {
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (!base || !storagePath.trim()) return null;
  const cleanBase = base.replace(/\/$/, "");
  const encodedPath = storagePath
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `${cleanBase}/storage/v1/object/public/${BUCKET}/${encodedPath}`;
}

/**
 * URI for <Image source={{ uri }} />: stable public URL from `poster_storage_path` or parsed legacy
 * `poster_url`; otherwise any remaining absolute URL (e.g. external demo image).
 */
export function resolveDealPosterDisplayUri(
  posterUrl: string | null | undefined,
  posterStoragePath?: string | null,
): string | null {
  const explicit = posterStoragePath?.trim();
  const path = explicit || extractDealPhotoStoragePath(posterUrl ?? null);
  if (path) {
    const pub = buildPublicDealPhotoUrl(path);
    if (pub) return pub;
  }
  const raw = posterUrl?.trim();
  if (raw && /^https?:\/\//i.test(raw)) return raw;
  return null;
}
