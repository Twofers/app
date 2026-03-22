import { supabase } from "./supabase";

export function parseFunctionError(error: any): string {
  // Supabase functions.invoke error structure:
  // - error.message: response body as string (often JSON)
  // - error.context: additional context
  // - error.context?.body: parsed response body (if available)
  
  let errorMessage = "Unknown error";
  
  // Try error.context.body first (parsed JSON)
  if (error.context?.body && typeof error.context.body === "object") {
    if (error.context.body.error) {
      return error.context.body.error;
    }
  }
  
  // Try error.message (might be JSON string)
  if (error.message) {
    errorMessage = error.message;
    
    // Try to parse as JSON
    try {
      const parsed = JSON.parse(errorMessage);
      if (parsed.error) {
        return parsed.error;
      }
    } catch {
      // Not JSON, use message as-is
    }
  }
  
  // Fallback to error message or context
  return errorMessage || error.context?.message || "Unknown error";
}

export async function claimDeal(dealId: string) {
  const { data, error } = await supabase.functions.invoke("claim-deal", {
    body: { deal_id: dealId },
  });

  if (error) {
    throw new Error(parseFunctionError(error));
  }

  // Check if data itself contains an error (shouldn't happen with proper function, but be safe)
  if (data && typeof data === "object" && "error" in data) {
    throw new Error((data as any).error || "Server returned an error");
  }

  if (!data || !data.token) {
    throw new Error("No token returned from server");
  }

  return data as {
    token: string;
    expires_at: string;
  };
}

export async function redeemToken(token: string) {
  const { data, error } = await supabase.functions.invoke("redeem-token", {
    body: { token },
  });

  if (error) {
    throw new Error(parseFunctionError(error));
  }

  // Check if data itself contains an error
  if (data && typeof data === "object" && "error" in data) {
    throw new Error((data as any).error || "Server returned an error");
  }

  if (!data || !data.ok) {
    throw new Error("Token redemption failed");
  }

  return data as {
    ok: boolean;
    deal_title?: string;
    redeemed_at: string;
  };
}
