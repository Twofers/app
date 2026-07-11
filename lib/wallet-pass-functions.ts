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
