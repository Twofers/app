import { EDGE_FUNCTION_TIMEOUT_MS, parseFunctionError } from "./functions";
import { supabase } from "./supabase";

export type OwnerRedemptionSecurityStatus = {
  enabled: boolean;
  hasPin: boolean;
  lockedUntil: string | null;
};

type OwnerRedemptionSecurityResponse = {
  ok?: boolean;
  enabled?: boolean;
  has_pin?: boolean;
  locked_until?: string | null;
  unlocked?: boolean;
  error?: string;
};

async function invokeErrorMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (typeof Response !== "undefined" && ctx instanceof Response) {
    try {
      const body = await ctx.clone().json();
      if (body && typeof body === "object") {
        const message = (body as { error?: unknown; message?: unknown }).error ?? (body as { message?: unknown }).message;
        if (typeof message === "string" && message.trim()) return message;
      }
    } catch {
      /* fall through */
    }
  }
  return parseFunctionError(error);
}

async function invokeOwnerRedemptionSecurity(
  action: "status" | "enable" | "disable" | "verify" | "change",
  businessId: string,
  pin?: string,
  newPin?: string,
): Promise<OwnerRedemptionSecurityResponse> {
  const { data, error } = await supabase.functions.invoke("owner-redemption-security", {
    body: {
      action,
      business_id: businessId,
      ...(pin != null ? { pin } : {}),
      ...(newPin != null ? { new_pin: newPin } : {}),
    },
    timeout: EDGE_FUNCTION_TIMEOUT_MS,
  });
  if (error) throw new Error(await invokeErrorMessage(error));
  const result = data as OwnerRedemptionSecurityResponse | null;
  if (!result || typeof result !== "object") throw new Error("Unexpected redemption PIN response.");
  if (result.error && result.ok !== true) throw new Error(result.error);
  return result;
}

export async function getOwnerRedemptionSecurityStatus(businessId: string): Promise<OwnerRedemptionSecurityStatus> {
  const result = await invokeOwnerRedemptionSecurity("status", businessId);
  return {
    enabled: result.enabled === true,
    hasPin: result.has_pin === true,
    lockedUntil: typeof result.locked_until === "string" ? result.locked_until : null,
  };
}

export async function enableOwnerRedemptionPin(businessId: string, pin: string): Promise<void> {
  await invokeOwnerRedemptionSecurity("enable", businessId, pin);
}

export async function disableOwnerRedemptionPin(businessId: string, pin?: string): Promise<void> {
  await invokeOwnerRedemptionSecurity("disable", businessId, pin);
}

export async function changeOwnerRedemptionPin(businessId: string, currentPin: string, newPin: string): Promise<void> {
  await invokeOwnerRedemptionSecurity("change", businessId, currentPin, newPin);
}

export async function verifyOwnerRedemptionPin(businessId: string, pin: string): Promise<boolean> {
  const result = await invokeOwnerRedemptionSecurity("verify", businessId, pin);
  return result.unlocked === true;
}
