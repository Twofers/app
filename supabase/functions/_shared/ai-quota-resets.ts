export type AiQuotaScope =
  | "ad_generation"
  | "compose_offer"
  | "deal_copy"
  | "deal_suggestions"
  | "deal_translate";

export const AI_QUOTA_SCOPES: readonly AiQuotaScope[] = [
  "ad_generation",
  "compose_offer",
  "deal_copy",
  "deal_suggestions",
  "deal_translate",
] as const;

export function isAiQuotaScope(value: unknown): value is AiQuotaScope {
  return typeof value === "string" && (AI_QUOTA_SCOPES as readonly string[]).includes(value);
}

export function utcMonthStartIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
}

export function utcMonthStartDate(now = new Date()): string {
  return utcMonthStartIso(now).slice(0, 10);
}

export function requestTypesForQuotaScope(scope: AiQuotaScope): string[] {
  switch (scope) {
    case "ad_generation":
      return ["ad_variants", "ad_refine"];
    case "compose_offer":
      return ["compose_offer"];
    case "deal_copy":
      return ["deal_copy"];
    case "deal_suggestions":
      return ["deal_suggestions"];
    case "deal_translate":
      return ["deal_translate"];
  }
}

function countOnlySuccessfulProviderCalls(scope: AiQuotaScope): boolean {
  return scope === "ad_generation" || scope === "compose_offer";
}

export async function latestAiQuotaResetAt(
  admin: any,
  params: {
    businessId: string;
    scope: AiQuotaScope;
    monthStartIso?: string;
  },
): Promise<string | null> {
  const periodStart = (params.monthStartIso ?? utcMonthStartIso()).slice(0, 10);
  const { data, error } = await admin
    .from("admin_ai_quota_resets")
    .select("reset_at")
    .eq("business_id", params.businessId)
    .eq("quota_scope", params.scope)
    .eq("period_start", periodStart)
    .order("reset_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(JSON.stringify({
      tag: "ai_quota_reset",
      event: "lookup_failed",
      errorCode: "AI_QUOTA_RESET_LOOKUP_FAILED",
      scope: params.scope,
    }));
    return null;
  }

  return typeof data?.reset_at === "string" ? data.reset_at : null;
}

export async function aiQuotaCountBoundary(
  admin: any,
  params: {
    businessId: string;
    scope: AiQuotaScope;
    monthStartIso?: string;
  },
): Promise<{ countSinceIso: string; resetAt: string | null }> {
  const monthStartIso = params.monthStartIso ?? utcMonthStartIso();
  const resetAt = await latestAiQuotaResetAt(admin, {
    businessId: params.businessId,
    scope: params.scope,
    monthStartIso,
  });

  if (!resetAt) return { countSinceIso: monthStartIso, resetAt: null };

  const resetMs = new Date(resetAt).getTime();
  const monthMs = new Date(monthStartIso).getTime();
  if (!Number.isFinite(resetMs) || resetMs <= monthMs) {
    return { countSinceIso: monthStartIso, resetAt };
  }

  return { countSinceIso: resetAt, resetAt };
}

export async function countAiQuotaUsage(
  admin: any,
  params: {
    businessId: string;
    scope: AiQuotaScope;
    monthStartIso?: string;
  },
): Promise<{ used: number; countSinceIso: string; resetAt: string | null }> {
  const boundary = await aiQuotaCountBoundary(admin, params);
  const requestTypes = requestTypesForQuotaScope(params.scope);
  let query = admin
    .from("ai_generation_logs")
    .select("id", { count: "exact", head: true })
    .eq("business_id", params.businessId)
    .gte("created_at", boundary.countSinceIso);

  if (requestTypes.length === 1) {
    query = query.eq("request_type", requestTypes[0]);
  } else {
    query = query.in("request_type", requestTypes);
  }

  if (countOnlySuccessfulProviderCalls(params.scope)) {
    query = query.eq("openai_called", true).eq("success", true);
  }

  const { count, error } = await query;
  if (error) throw error;

  return {
    used: count ?? 0,
    countSinceIso: boundary.countSinceIso,
    resetAt: boundary.resetAt,
  };
}
