/** Structured deal columns used to render customer-facing offer mechanics from facts instead of AI prose. */
export const DEAL_STRUCTURED_DISPLAY_COLUMNS =
  "deal_type,discount_percent,item_description,item_retail_value_cents,required_purchase_quantity,free_item_quantity,required_item_description,required_item_retail_value_cents,free_item_description,free_item_retail_value_cents,free_item_discount_percent,customer_value_percent,applies_to";

/** Base Supabase select string for active deal surfaces. Keep this compatible with older DB states. */
export const DEAL_FEED_BASE_SELECT =
  "id,title,description,source_locale,title_en,title_es,title_ko,description_en,description_es,description_ko,start_time,end_time,created_at,is_active,is_demo,poster_url,poster_storage_path,business_id,price,max_claims,businesses(name,category,location,latitude,longitude,is_demo),is_recurring,days_of_week,window_start_minutes,window_end_minutes,timezone";

/** Shared enriched select string for consumer deal feeds. Falls back to DEAL_FEED_BASE_SELECT when staged columns are absent. */
export const DEAL_FEED_SELECT = `${DEAL_FEED_BASE_SELECT},${DEAL_STRUCTURED_DISPLAY_COLUMNS}`;

const STRUCTURED_DISPLAY_COLUMN_NAMES = DEAL_STRUCTURED_DISPLAY_COLUMNS.split(",");

export function isMissingStructuredDisplayColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  const message = error?.message ?? "";
  const lower = message.toLowerCase();
  return (
    Boolean(error) &&
    (error?.code === "PGRST204" || error?.code === "42703" || lower.includes("schema cache") || lower.includes("column")) &&
    STRUCTURED_DISPLAY_COLUMN_NAMES.some((column) => lower.includes(column))
  );
}

export type DealStructuredDisplayFields = {
  deal_type?: string | null;
  discount_percent?: number | string | null;
  item_description?: string | null;
  item_retail_value_cents?: number | null;
  required_purchase_quantity?: number | string | null;
  free_item_quantity?: number | string | null;
  required_item_description?: string | null;
  required_item_retail_value_cents?: number | null;
  free_item_description?: string | null;
  free_item_retail_value_cents?: number | null;
  free_item_discount_percent?: number | string | null;
  customer_value_percent?: number | string | null;
  applies_to?: string | null;
};

export type Deal = DealStructuredDisplayFields & {
  id: string;
  title: string | null;
  description: string | null;
  source_locale: string | null;
  title_en: string | null;
  title_es: string | null;
  title_ko: string | null;
  description_en: string | null;
  description_es: string | null;
  description_ko: string | null;
  end_time: string;
  is_active: boolean;
  is_demo?: boolean | null;
  poster_url: string | null;
  poster_storage_path?: string | null;
  business_id: string;
  price: number | null;
  max_claims: number | null;
  businesses?: {
    name: string | null;
    category: string | null;
    location: string | null;
    latitude: number | string | null;
    longitude: number | string | null;
    is_demo?: boolean | null;
  } | null;
  start_time: string;
  created_at?: string | null;
  is_recurring: boolean;
  days_of_week: number[] | null;
  window_start_minutes: number | null;
  window_end_minutes: number | null;
  timezone: string | null;
};
