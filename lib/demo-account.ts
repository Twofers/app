/** Preview / dev demo account — must match EAS preview `EXPO_PUBLIC_ENABLE_DEMO_AUTH_HELPER` flows and SQL seed. */
export const DEMO_PREVIEW_EMAIL = "demo@demo.com";
export const DEMO_PREVIEW_PASSWORD = "demo12345";

export function isDemoPreviewAccountEmail(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() === DEMO_PREVIEW_EMAIL;
}
