import { supabase } from "./supabase";
import { EDGE_FUNCTION_TIMEOUT_MS, parseFunctionError } from "./functions";

/**
 * Native wallet pass ("Twofer Card"): asks the server for a fresh
 * Save-to-Google-Wallet URL. Lives outside lib/functions.ts on purpose —
 * that file is under the AI poster core lock.
 */
export async function issueWalletPass(platform: "google" | "apple", locale: string) {
  const { data, error } = await supabase.functions.invoke("wallet-pass-issue", {
    body: { platform, locale },
    timeout: EDGE_FUNCTION_TIMEOUT_MS,
  });
  if (error) throw new Error(parseFunctionError(error));
  if (data && typeof data === "object" && "error" in data) {
    throw new Error((data as { error?: string }).error ?? "Server returned an error");
  }
  return data as { save_url: string };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read wallet pass data."));
    reader.onloadend = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Apple Wallet: the .pkpass is BINARY, and supabase.functions.invoke decodes
 * unknown content-types as text (which corrupts it), so fetch the endpoint
 * directly and read it as a Blob. Returns the base64 pass bytes for writing to
 * a file + handing to PassKit via the iOS share sheet.
 */
export async function fetchAppleWalletPassBase64(locale: string): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Please sign in to add your card.");
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const res = await fetch(`${base}/functions/v1/wallet-pass-issue`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ platform: "apple", locale }),
  });
  if (!res.ok) {
    let msg = "Couldn't create your Apple Wallet card. Try again.";
    try {
      const body = await res.json();
      if (body?.error) msg = String(body.error);
    } catch {
      // non-JSON error body
    }
    throw new Error(msg);
  }
  return blobToBase64(await res.blob());
}
