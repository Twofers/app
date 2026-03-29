/** Detect PostgREST errors when `business_menu_items` migration is missing. */
export function looksLikeMissingMenuTable(message: string): boolean {
  const low = message.toLowerCase();
  return (
    low.includes("business_menu_items") ||
    low.includes("could not find the table") ||
    low.includes("does not exist") ||
    low.includes("schema cache") ||
    (low.includes("relation") && low.includes("not exist"))
  );
}
