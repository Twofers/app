import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const homeSource = readFileSync(join(process.cwd(), "app", "(tabs)", "index.tsx"), "utf8");
const composedTemplateFiles = [
  "HeroImageOverlayTemplate.tsx",
  "LiveDropCardTemplate.tsx",
  "LocalDiscoveryTemplate.tsx",
  "SignatureItemTemplate.tsx",
  "SocialMomentTemplate.tsx",
  "SplitOfferPanelTemplate.tsx",
];

describe("deal poster aspect ratio source guards", () => {
  it("keeps the legacy Home feed poster slot square", () => {
    expect(homeSource).toMatch(/style=\{\{ width: "100%", aspectRatio: 1 \}\}/);
    expect(homeSource).not.toMatch(/heroImageHeight/);
  });

  it("keeps composed feed image slots square", () => {
    for (const file of composedTemplateFiles) {
      const source = readFileSync(join(process.cwd(), "components", "composed-ad-card", "templates", file), "utf8");
      expect(source).toMatch(/aspectRatio: 1/);
    }
  });
});
