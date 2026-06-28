import type { AiProviderErrorClass, AiProviderName } from "./ai-provider-errors.ts";

export type AiProviderCapability =
  | "text_generation"
  | "candidate_judging"
  | "vision_qa"
  | "image_generation";

export type CircuitBreakerDecision = {
  allowed: boolean;
  probe: boolean;
  state: "closed" | "open" | "half_open";
  disabledUntil: string | null;
  failureCount: number;
};

type CircuitRow = {
  provider: string;
  capability: string;
  state: string;
  failure_count: number;
  last_error_class: string | null;
  opened_at: string | null;
  disabled_until: string | null;
  last_probe_at: string | null;
  updated_at: string;
};

type SupabaseLike = {
  from(table: string): any;
};

function addMs(date: Date, ms: number): string {
  return new Date(date.getTime() + ms).toISOString();
}

function isOpenUntil(row: CircuitRow, now: Date): boolean {
  if (row.state !== "open") return false;
  if (!row.disabled_until) return true;
  return new Date(row.disabled_until).getTime() > now.getTime();
}

function shouldOpenForFailure(errorClass: AiProviderErrorClass, failureCount: number): {
  open: boolean;
  disabledUntilMs: number;
} {
  if (
    errorClass === "quota_exhausted" ||
    errorClass === "insufficient_credits" ||
    errorClass === "spend_limit_reached" ||
    errorClass === "billing_hard_limit" ||
    errorClass === "authentication" ||
    errorClass === "configuration"
  ) {
    return { open: true, disabledUntilMs: 30 * 60 * 1000 };
  }
  if (failureCount >= 3) return { open: true, disabledUntilMs: 2 * 60 * 1000 };
  return { open: false, disabledUntilMs: 0 };
}

export async function getCircuitBreakerDecision(params: {
  admin: SupabaseLike | null | undefined;
  provider: AiProviderName;
  capability: AiProviderCapability;
  now?: Date;
}): Promise<CircuitBreakerDecision> {
  const now = params.now ?? new Date();
  if (!params.admin) {
    return { allowed: true, probe: false, state: "closed", disabledUntil: null, failureCount: 0 };
  }
  try {
    const { data, error } = await params.admin
      .from("ai_provider_circuit_breakers")
      .select("provider, capability, state, failure_count, last_error_class, opened_at, disabled_until, last_probe_at, updated_at")
      .eq("provider", params.provider)
      .eq("capability", params.capability)
      .maybeSingle();
    if (error || !data) {
      return { allowed: true, probe: false, state: "closed", disabledUntil: null, failureCount: 0 };
    }
    const row = data as CircuitRow;
    if (isOpenUntil(row, now)) {
      return {
        allowed: false,
        probe: false,
        state: "open",
        disabledUntil: row.disabled_until,
        failureCount: row.failure_count,
      };
    }
    if (row.state === "open") {
      await params.admin.from("ai_provider_circuit_breakers").upsert({
        provider: params.provider,
        capability: params.capability,
        state: "half_open",
        last_probe_at: now.toISOString(),
        updated_at: now.toISOString(),
      });
      return {
        allowed: true,
        probe: true,
        state: "half_open",
        disabledUntil: row.disabled_until,
        failureCount: row.failure_count,
      };
    }
    return {
      allowed: true,
      probe: false,
      state: row.state === "half_open" ? "half_open" : "closed",
      disabledUntil: row.disabled_until,
      failureCount: row.failure_count,
    };
  } catch (error) {
    console.warn(
      JSON.stringify({
        tag: "ai_provider_circuit_breaker",
        event: "decision_failed",
        provider: params.provider,
        capability: params.capability,
        errorCode: "CIRCUIT_BREAKER_DECISION_FAILED",
      }),
    );
    return { allowed: true, probe: false, state: "closed", disabledUntil: null, failureCount: 0 };
  }
}

export async function recordCircuitBreakerSuccess(params: {
  admin: SupabaseLike | null | undefined;
  provider: AiProviderName;
  capability: AiProviderCapability;
  now?: Date;
}): Promise<void> {
  if (!params.admin) return;
  const now = params.now ?? new Date();
  try {
    await params.admin.from("ai_provider_circuit_breakers").upsert({
      provider: params.provider,
      capability: params.capability,
      state: "closed",
      failure_count: 0,
      last_error_class: null,
      opened_at: null,
      disabled_until: null,
      updated_at: now.toISOString(),
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        tag: "ai_provider_circuit_breaker",
        event: "success_record_failed",
        provider: params.provider,
        capability: params.capability,
        errorCode: "CIRCUIT_BREAKER_SUCCESS_RECORD_FAILED",
      }),
    );
  }
}

export async function recordCircuitBreakerFailure(params: {
  admin: SupabaseLike | null | undefined;
  provider: AiProviderName;
  capability: AiProviderCapability;
  errorClass: AiProviderErrorClass;
  previousFailureCount?: number;
  now?: Date;
}): Promise<void> {
  if (!params.admin) return;
  const now = params.now ?? new Date();
  const failureCount = Math.max(0, params.previousFailureCount ?? 0) + 1;
  const openDecision = shouldOpenForFailure(params.errorClass, failureCount);
  try {
    await params.admin.from("ai_provider_circuit_breakers").upsert({
      provider: params.provider,
      capability: params.capability,
      state: openDecision.open ? "open" : "closed",
      failure_count: failureCount,
      last_error_class: params.errorClass,
      opened_at: openDecision.open ? now.toISOString() : null,
      disabled_until: openDecision.open ? addMs(now, openDecision.disabledUntilMs) : null,
      updated_at: now.toISOString(),
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        tag: "ai_provider_circuit_breaker",
        event: "failure_record_failed",
        provider: params.provider,
        capability: params.capability,
        errorClass: params.errorClass,
        errorCode: "CIRCUIT_BREAKER_FAILURE_RECORD_FAILED",
      }),
    );
  }
}
