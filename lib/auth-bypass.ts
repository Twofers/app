export function isAuthBypassEnabled(params: {
  skipSetup?: string;
  e2e?: string;
  isDev: boolean;
}): boolean {
  if (!params.isDev) return false;
  return String(params.e2e ?? "") === "1" || String(params.skipSetup ?? "") === "1";
}
