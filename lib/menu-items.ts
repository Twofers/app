import { supabase } from "./supabase";

export type MenuItem = {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  category: string | null;
  price: number | null;
  image_url: string | null;
  sort_order: number;
  is_available: boolean;
  created_at: string;
  updated_at: string;
};

export type ExtractedMenuItem = {
  name: string;
  description: string | null;
  category: string | null;
  price: number | null;
};

export type MenuExtractionResult = {
  items: ExtractedMenuItem[];
  confidence: number;
  error?: string;
};

export async function extractMenuFromImage(
  imageBase64: string,
  businessId: string,
  extractPrices: boolean,
): Promise<MenuExtractionResult> {
  const { data, error } = await supabase.functions.invoke("extract-menu-items", {
    body: {
      image_base64: imageBase64,
      extract_prices: extractPrices,
      business_id: businessId,
    },
  });

  if (error) {
    throw new Error(error.message ?? "Menu extraction failed");
  }

  return data as MenuExtractionResult;
}

export async function fetchMenuItems(businessId: string): Promise<MenuItem[]> {
  const { data, error } = await supabase
    .from("menu_items")
    .select("*")
    .eq("business_id", businessId)
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as MenuItem[];
}

export async function saveExtractedItems(
  businessId: string,
  items: ExtractedMenuItem[],
): Promise<void> {
  if (items.length === 0) return;

  const rows = items.map((item, idx) => ({
    business_id: businessId,
    name: item.name,
    description: item.description,
    category: item.category,
    price: item.price,
    sort_order: idx,
    is_available: true,
  }));

  const { error } = await supabase.from("menu_items").insert(rows);
  if (error) throw new Error(error.message);
}

export async function updateMenuItem(
  id: string,
  updates: Partial<Pick<MenuItem, "name" | "description" | "category" | "price" | "is_available">>,
): Promise<void> {
  const { error } = await supabase
    .from("menu_items")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteMenuItem(id: string): Promise<void> {
  const { error } = await supabase.from("menu_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
