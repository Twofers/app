/**
 * Deterministic menu-item name/description splitter.
 *
 * Menu extraction models sometimes pack a descriptive blurb into the item name,
 * e.g. "the recon roast ( Roaster fresh coffee with a shot of espresso)". That
 * long name then leaks into offer item names and deal titles. This helper moves
 * a trailing parenthetical into a separate description — but only when it reads
 * like a description (4+ words), so short qualifiers such as "(12 pc)" or
 * "(gluten free)" stay part of the name.
 *
 * Kept in sync with the app-side copy in `lib/menu-item-text.ts` (the app cannot
 * import Deno function code, and vice versa).
 */

const MIN_DESCRIPTION_WORDS = 4;
export const MAX_MENU_ITEM_DESCRIPTION_CHARS = 500;

export function splitMenuItemDescription(raw: string): {
  name: string;
  description: string | null;
} {
  const input = typeof raw === "string" ? raw.trim() : "";
  const match = /^(.*)\(([^()]*)\)\s*$/.exec(input);
  if (!match) return { name: input, description: null };
  const name = match[1].trim();
  const description = match[2].trim();
  const wordCount = description.split(/\s+/).filter(Boolean).length;
  if (!name || wordCount < MIN_DESCRIPTION_WORDS) {
    return { name: input, description: null };
  }
  return { name, description };
}
