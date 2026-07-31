// T0 GUARD RAIL for the "Translate" plan (docs/plans/translate.md).
//
// Dan's hard constraint: the item-name translation work "cannot affect any other
// part of the deal creation that is already working well." This test makes that
// enforceable rather than promised. It scans every screen under app/create/ and
// fails if any of them reaches for the customer-only item-translation surface:
//
//   - the T2 expansion dictionary module (lib/localized-offer-terms-expansion), or
//   - the T2 per-viewer switch (EXPO_PUBLIC_DEAL_ITEM_TRANSLATION_LOCALES and its
//     resolver `dealItemTranslationLocales`).
//
// Those names do not exist yet — this passes trivially today and becomes load-
// bearing the moment T2 adds them. If a future change wires item-name expansion
// into the create/owner-preview path, this test goes red first, on purpose.
//
// Nothing here pins how creation works; it only pins what creation must NOT
// import. Creation's real behavior is frozen elsewhere by its own suites.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const CREATE_DIR = join(process.cwd(), "app", "create");

// Symbols the customer-only item-translation feature owns. The create path may
// never reference any of them.
const FORBIDDEN_IN_CREATE = [
  "localized-offer-terms-expansion",
  "EXPO_PUBLIC_DEAL_ITEM_TRANSLATION_LOCALES",
  "dealItemTranslationLocales",
];

function createPathFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return createPathFiles(full);
    return /\.(tsx?|ts)$/.test(entry.name) ? [full] : [];
  });
}

describe("item-name translation stays out of deal creation — T0 source guard", () => {
  const files = createPathFiles(CREATE_DIR);

  it("finds the create screens (guard is not vacuous)", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(FORBIDDEN_IN_CREATE)("no app/create file references %s", (token) => {
    const offenders = files.filter((file) => readFileSync(file, "utf8").includes(token));
    expect(offenders).toEqual([]);
  });
});
