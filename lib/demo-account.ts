/**
 * Preview / dev demo account — must match `npm run seed:demo` / `scripts/seed-demo.cjs` and EAS preview helpers.
 * Email is **demo@demo.com** (not other domains); password **demo12345**.
 */
export const DEMO_PREVIEW_EMAIL = process.env.EXPO_PUBLIC_DEMO_EMAIL ?? "";
export const DEMO_PREVIEW_PASSWORD = process.env.EXPO_PUBLIC_DEMO_PASSWORD ?? "";

export function isDemoPreviewAccountEmail(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() === DEMO_PREVIEW_EMAIL;
}
