import type { GeneratedAd } from "./ad-variants";
import {
  buildAdSpecV1,
  type AdSpecV1,
  type AdSpecSource,
} from "./ad-spec";
import type { OfferDefinitionV1 } from "./offer-definition";
import { EDGE_FN_TIMEOUT_DEFAULT_MS } from "@/constants/timing";

export type OfferVersionPublishDealRow = Record<string, unknown> & {
  business_id: string;
};

export type OfferVersionPublishAdSpec = AdSpecV1;

export type PublishOfferVersionedDealBody = {
  business_id: string;
  offer_definition: OfferDefinitionV1;
  deal_rows: OfferVersionPublishDealRow[];
  idempotency_key: string;
  ad_spec?: OfferVersionPublishAdSpec | null;
};

export type PublishOfferVersionedDealResult = {
  ok: boolean;
  deals: Array<{
    deal_id: string;
    offer_definition_id: string;
    offer_version_id: string;
    idempotency_replayed?: boolean;
  }>;
};

type ErrorWithCode = Error & { code?: string };

function throwInvokeError(message: string, code?: string): never {
  const err = new Error(message) as ErrorWithCode;
  if (code) err.code = code;
  throw err;
}

function parsePublishFunctionError(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message === "string" && message.trim()) return message;
  return "We couldn't publish this offer right now. Please try again.";
}

async function readInvokeErrorBody(error: unknown): Promise<{ message?: string; code?: string }> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (typeof Response !== "undefined" && ctx instanceof Response) {
    try {
      const data = await ctx.clone().json();
      if (data && typeof data === "object") {
        const o = data as { error?: unknown; error_code?: unknown };
        return {
          message: typeof o.error === "string" ? o.error : undefined,
          code: typeof o.error_code === "string" ? o.error_code : undefined,
        };
      }
    } catch {
      /* fall through to parseFunctionError */
    }
  }
  return {};
}

export function createPublishIdempotencyKey(scope: "create_ai" | "create_quick"): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  const id =
    typeof randomUUID === "function"
      ? randomUUID.call(globalThis.crypto)
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${scope}:${id}`;
}

export function buildOfferVersionPublishAdSpec(
  source: AdSpecSource,
  offerDefinition: OfferDefinitionV1,
  generatedAd: GeneratedAd | null | undefined,
): OfferVersionPublishAdSpec {
  return buildAdSpecV1({
    source,
    offerDefinition,
    generatedAd,
  });
}

export async function publishOfferVersionedDeal(
  body: PublishOfferVersionedDealBody,
): Promise<PublishOfferVersionedDealResult> {
  const { supabase } = await import("./supabase");
  const { data, error } = await supabase.functions.invoke("publish-offer-version", {
    body,
    timeout: EDGE_FN_TIMEOUT_DEFAULT_MS,
  });
  if (error) {
    const fromBody = await readInvokeErrorBody(error);
    throwInvokeError(fromBody.message ?? parsePublishFunctionError(error), fromBody.code);
  }
  if (!data || typeof data !== "object" || (data as { ok?: unknown }).ok !== true) {
    throw new Error("Unexpected response from publish-offer-version.");
  }
  const result = data as PublishOfferVersionedDealResult;
  return {
    ok: true,
    deals: Array.isArray(result.deals) ? result.deals : [],
  };
}
