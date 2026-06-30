import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const customerCardPaths = [
  join(process.cwd(), "app", "(tabs)", "index.tsx"),
  join(process.cwd(), "app", "deal", "[id].tsx"),
  join(process.cwd(), "app", "business", "[id].tsx"),
  join(process.cwd(), "app", "(tabs)", "wallet.tsx"),
  join(process.cwd(), "components", "map", "map-native-screen.tsx"),
];

describe("customer localized deal paths", () => {
  it("renders customer deal surfaces through the shared localized display helper", () => {
    for (const path of customerCardPaths) {
      const source = readFileSync(path, "utf8");
      expect(source).toMatch(/buildLocalizedDealDisplay/);
      expect(source).not.toMatch(/localizedDealTitle/);
      expect(source).not.toMatch(/localizedDealDescription/);
    }
  });

  it("fetches approved customer localizations without requiring the exact-offer renderer flag", () => {
    for (const path of customerCardPaths) {
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(/!customerLocaleResolutionEnabled\s*\|\|\s*!localizedOfferRendererEnabled/);
      expect(source).not.toMatch(/customerLocaleResolutionEnabled\s*&&\s*localizedOfferRendererEnabled/);
    }
  });
});
