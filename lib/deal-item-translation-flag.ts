// Per-viewer switch for the expanded item-name dictionary on CUSTOMER deal
// surfaces (docs/plans/translate.md, phase T2).
//
// A comma list of the viewer locales whose out-of-base item names should
// localize, e.g. "en-US,es-US,ko-KR". Empty/unset = OFF = today's behavior:
// only the reviewed base dictionary is consulted. Turning a locale off ships
// instantly via an OTA update — the safety valve for this feature.
//
// Deliberately dependency-free (no expo-constants / react-native) so importing
// it does not pull the RN graph into the otherwise-pure display libraries.
// Expo inlines process.env.EXPO_PUBLIC_* at build time; the non-prefixed twin
// covers Node/test contexts. Same pattern as lib/runtime-env.ts's flag reads.

const ALLOWED_LOCALES = new Set(["en-US", "es-US", "ko-KR"]);

export function dealItemTranslationLocales(): string[] {
  const raw =
    process.env.DEAL_ITEM_TRANSLATION_LOCALES ||
    process.env.EXPO_PUBLIC_DEAL_ITEM_TRANSLATION_LOCALES ||
    "";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => ALLOWED_LOCALES.has(value));
}
