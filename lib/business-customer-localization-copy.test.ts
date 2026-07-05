import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type LocaleTree = Record<string, unknown>;

const TARGETED_NAMESPACES = [
  "menuScan",
  "menuOffer",
  "createAi",
  "businessSetup",
  "account",
  "redeem",
  "offersDashboard",
  "dealDetail",
  "consumerWallet",
  "settingsScreen",
] as const;

const INTENTIONALLY_NEUTRAL_VALUES = new Set([
  "createAi.qaPlaceholder",
  "createAi.placeholderPrice",
  "createAi.placeholderMaxClaims",
  "createAi.placeholderCutoff",
  "consumerWallet.passSecondsUnit",
  "consumerWallet.countdownLabel",
  "consumerWallet.statSavedValue",
]);

function readLocale(locale: "en" | "es" | "ko"): LocaleTree {
  return JSON.parse(readFileSync(join(process.cwd(), "lib", "i18n", "locales", `${locale}.json`), "utf8")) as LocaleTree;
}

function flattenStrings(value: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) {
      flattenStrings(child, path, out);
    } else if (typeof child === "string") {
      out[path] = child;
    }
  }
  return out;
}

function isTargetedKey(key: string): boolean {
  return TARGETED_NAMESPACES.some((namespace) => key.startsWith(`${namespace}.`));
}

describe("business and customer localization copy", () => {
  it("keeps active Spanish and Korean locale files complete against English", () => {
    const english = flattenStrings(readLocale("en"));
    for (const locale of ["es", "ko"] as const) {
      const translated = flattenStrings(readLocale(locale));
      const missing = Object.keys(english).filter((key) => !(key in translated));

      expect(missing).toEqual([]);
    }
  });

  it("does not leave targeted business/customer UI strings in English", () => {
    const english = flattenStrings(readLocale("en"));
    const targetedKeys = Object.keys(english).filter(isTargetedKey);

    for (const locale of ["es", "ko"] as const) {
      const translated = flattenStrings(readLocale(locale));
      const sameAsEnglish = targetedKeys.filter(
        (key) => !INTENTIONALLY_NEUTRAL_VALUES.has(key) && translated[key] === english[key],
      );

      expect(sameAsEnglish).toEqual([]);
    }
  });
});
