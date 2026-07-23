import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type DbClient = SupabaseClient<any, any, any, any, any>;

export type BusinessCapability =
  | "can_edit_business_information"
  | "can_use_setup_tools"
  | "can_use_menu_tools"
  | "can_extract_initial_menu"
  | "can_create_text_draft"
  | "can_generate_ai"
  | "can_consume_offer_credits"
  | "can_publish_offer"
  | "can_receive_new_claims"
  | "can_redeem_existing_claims"
  | "can_manage_billing";

export type BusinessCapabilities = Record<BusinessCapability, boolean> & {
  reason_code: string;
  setup_menu_extractions_remaining?: number;
  publish?: Record<string, unknown>;
};

const DENIED_CAPABILITIES: BusinessCapabilities = {
  reason_code: "capability_unavailable",
  can_edit_business_information: false,
  can_use_setup_tools: false,
  can_use_menu_tools: false,
  can_extract_initial_menu: false,
  can_create_text_draft: false,
  can_generate_ai: false,
  can_consume_offer_credits: false,
  can_publish_offer: false,
  can_receive_new_claims: false,
  can_redeem_existing_claims: false,
  can_manage_billing: false,
};

const BOOLEAN_CAPABILITIES: BusinessCapability[] = [
  "can_edit_business_information",
  "can_use_setup_tools",
  "can_use_menu_tools",
  "can_extract_initial_menu",
  "can_create_text_draft",
  "can_generate_ai",
  "can_consume_offer_credits",
  "can_publish_offer",
  "can_receive_new_claims",
  "can_redeem_existing_claims",
  "can_manage_billing",
];

export async function getBusinessCapabilities(
  supabase: DbClient,
  businessId: string,
): Promise<BusinessCapabilities> {
  const { data, error } = await supabase.rpc("get_business_capabilities", {
    p_business_id: businessId,
  });
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ...DENIED_CAPABILITIES };
  }

  const value = data as Record<string, unknown>;
  const result = { ...DENIED_CAPABILITIES };
  for (const key of BOOLEAN_CAPABILITIES) {
    result[key] = value[key] === true;
  }
  result.reason_code =
    typeof value.reason_code === "string" && value.reason_code.trim()
      ? value.reason_code.trim()
      : DENIED_CAPABILITIES.reason_code;
  if (typeof value.setup_menu_extractions_remaining === "number") {
    result.setup_menu_extractions_remaining = Math.max(
      0,
      Math.trunc(value.setup_menu_extractions_remaining),
    );
  }
  if (value.publish && typeof value.publish === "object" && !Array.isArray(value.publish)) {
    result.publish = value.publish as Record<string, unknown>;
  }
  return result;
}

export async function assertBusinessCapability(
  supabase: DbClient,
  businessId: string,
  capability: BusinessCapability,
): Promise<BusinessCapabilities> {
  const capabilities = await getBusinessCapabilities(supabase, businessId);
  if (!capabilities[capability]) {
    const error = new Error(`BUSINESS_CAPABILITY_REQUIRED:${capability}:${capabilities.reason_code}`);
    error.name = "BusinessCapabilityError";
    throw error;
  }
  return capabilities;
}

export function isBusinessCapabilityError(error: unknown): boolean {
  return error instanceof Error && error.name === "BusinessCapabilityError";
}
