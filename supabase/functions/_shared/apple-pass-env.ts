/**
 * Native wallet pass — Apple signing/config material from edge secrets.
 * Shared by the issue path, the update web service, and the APNs push so none
 * of them import each other (avoids cycles). PEMs are stored base64 (ASCII),
 * so atob() yields the PEM text directly.
 */

export type AppleWalletEnv = {
  passTypeId: string;
  teamId: string;
  certPem: string;
  keyPem: string;
  wwdrPem: string;
};

export function getAppleWalletEnv(): AppleWalletEnv | null {
  const passTypeId = Deno.env.get("APPLE_PASS_TYPE_ID")?.trim();
  const teamId = Deno.env.get("APPLE_TEAM_ID")?.trim();
  const certB64 = Deno.env.get("APPLE_PASS_CERT_PEM_B64")?.trim();
  const keyB64 = Deno.env.get("APPLE_PASS_KEY_PEM_B64")?.trim();
  const wwdrB64 = Deno.env.get("APPLE_WWDR_CERT_PEM_B64")?.trim();
  if (!passTypeId || !teamId || !certB64 || !keyB64 || !wwdrB64) return null;
  try {
    return { passTypeId, teamId, certPem: atob(certB64), keyPem: atob(keyB64), wwdrPem: atob(wwdrB64) };
  } catch {
    console.error("[wallet-pass] apple signing secrets are not valid base64");
    return null;
  }
}

/** Public base URL of the PassKit web service (Apple appends /v1/...). */
export function getWalletWebServiceUrl(): string | null {
  const base = Deno.env.get("SUPABASE_URL")?.trim();
  return base ? `${base.replace(/\/$/, "")}/functions/v1/wallet-pass-webservice` : null;
}
