/** Shared Supabase select string for the deals feed query. Used by loadDeals and useRealtimeDeals. */
export const DEAL_FEED_SELECT =
  "id,title,description,source_locale,title_en,title_es,title_ko,description_en,description_es,description_ko,start_time,end_time,is_active,is_demo,poster_url,poster_storage_path,business_id,price,max_claims,deal_type,discount_percent,item_description,required_item_description,free_item_description,businesses(name,category,location,latitude,longitude,is_demo),is_recurring,days_of_week,window_start_minutes,window_end_minutes,timezone";

export type Deal = {
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
  deal_type?: string | null;
  discount_percent?: number | null;
  item_description?: string | null;
  required_item_description?: string | null;
  free_item_description?: string | null;
  businesses?: {
    name: string | null;
    category: string | null;
    location: string | null;
    latitude: number | string | null;
    longitude: number | string | null;
    is_demo?: boolean | null;
  } | null;
  start_time: string;
  is_recurring: boolean;
  days_of_week: number[] | null;
  window_start_minutes: number | null;
  window_end_minutes: number | null;
  timezone: string | null;
};
