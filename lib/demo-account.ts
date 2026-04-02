/**
 * Preview / dev demo account — must match `npm run seed:demo` / `scripts/seed-demo.cjs` and EAS preview helpers.
 * Email is **demo@demo.com** (not other domains); password **demo12345**.
 */
export const DEMO_PREVIEW_EMAIL = "demo@demo.com";
export const DEMO_PREVIEW_PASSWORD = "demo12345";

export function isDemoPreviewAccountEmail(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() === DEMO_PREVIEW_EMAIL;
}
