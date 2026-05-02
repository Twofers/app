/**
 * Deal posters are stored in Supabase Storage (`deal-photos`). Legacy rows often store a short-lived
 * signed URL in `poster_url`, which breaks the feed after expiry. Prefer resolving a stable path to
 * the public object URL (bucket is public-read for active deal art).
 *
 * Signed URLs created by edge functions use a 1-year expiry. This is acceptable because deals
 * themselves expire much sooner, so the URL will never outlive its usefulness.
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

export function buildPublicDealPhotoUrl(storagePath: string, opts?: { width?: number; quality?: number }): string | null {
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (!base || !storagePath.trim()) return null;
  const cleanBase = base.replace(/\/$/, "");
  const encodedPath = storagePath
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  const url = `${cleanBase}/storage/v1/object/public/${BUCKET}/${encodedPath}`;
  if (opts && (opts.width || opts.quality)) {
    const params = new URLSearchParams();
    if (opts.width) params.set("width", String(opts.width));
    if (opts.quality) params.set("quality", String(opts.quality));
    return `${url}?${params.toString()}`;
  }
  return url;
}

/** Recommended sizes for the consumer feed and detail screens. */
export const DEAL_POSTER_FEED_WIDTH = 720;
export const DEAL_POSTER_DETAIL_WIDTH = 1080;
export const DEAL_POSTER_QUALITY = 75;

/**
 * URI for <Image source={{ uri }} />: stable public URL from `poster_storage_path` or parsed legacy
 * `poster_url`; otherwise any remaining absolute URL (e.g. external demo image).
 *
 * `displayWidth` is forwarded to Supabase Storage's image transform so we don't ship a 4 MB
 * original to a 720px-wide card on cellular. Pass undefined to skip the transform.
 */
export function resolveDealPosterDisplayUri(
  posterUrl: string | null | undefined,
  posterStoragePath?: string | null,
  displayWidth?: number,
): string | null {
  const explicit = posterStoragePath?.trim();
  const path = explicit || extractDealPhotoStoragePath(posterUrl ?? null);
  if (path) {
    const pub = buildPublicDealPhotoUrl(
      path,
      displayWidth ? { width: displayWidth, quality: DEAL_POSTER_QUALITY } : undefined,
    );
    if (pub) return pub;
  }
  const raw = posterUrl?.trim();
  if (raw && /^https?:\/\//i.test(raw)) return raw;
  return null;
}
