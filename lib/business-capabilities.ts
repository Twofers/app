export type CanonicalBusinessCapabilities = {
  can_edit_business_information: boolean;
  can_use_setup_tools: boolean;
  can_use_menu_tools: boolean;
  can_extract_initial_menu: boolean;
  can_create_text_draft: boolean;
  can_generate_ai: boolean;
  can_consume_offer_credits: boolean;
  can_publish_offer: boolean;
  can_receive_new_claims: boolean;
  can_redeem_existing_claims: boolean;
  can_manage_billing: boolean;
  reason_code: string;
  setup_menu_extractions_remaining: number | null;
};

const BOOLEAN_KEYS = [
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
] as const;

export function parseBusinessCapabilities(value: unknown): CanonicalBusinessCapabilities | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const parsed = {
    reason_code:
      typeof row.reason_code === "string" && row.reason_code.trim()
        ? row.reason_code.trim()
        : "capability_unavailable",
    setup_menu_extractions_remaining:
      typeof row.setup_menu_extractions_remaining === "number"
        ? Math.max(0, Math.trunc(row.setup_menu_extractions_remaining))
        : null,
  } as CanonicalBusinessCapabilities;
  for (const key of BOOLEAN_KEYS) parsed[key] = row[key] === true;
  return parsed;
}
