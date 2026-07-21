import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const homeSource = readFileSync(join(process.cwd(), "app", "(tabs)", "index.tsx"), "utf8");

// HeroImageOverlay draws its text panel *inside* the image frame, so a square
// slot costs nothing. Every other composed template stacks text below the image,
// where a full-width square poster pushed the deal copy and claim button below
// the fold — those render the whole poster at 3:2 (contain over a blurred fill).
const overlayTemplateFiles = ["HeroImageOverlayTemplate.tsx"];
const textBelowTemplateFiles = [
  "LiveDropCardTemplate.tsx",
  "LocalDiscoveryTemplate.tsx",
  "SignatureItemTemplate.tsx",
  "SocialMomentTemplate.tsx",
  "SplitOfferPanelTemplate.tsx",
];

function readTemplate(file: string): string {
  return readFileSync(join(process.cwd(), "components", "composed-ad-card", "templates", file), "utf8");
}

describe("deal poster aspect ratio source guards", () => {
  it("keeps the legacy Home feed poster slot square", () => {
    expect(homeSource).toMatch(/style=\{\{ width: "100%", aspectRatio: 1 \}\}/);
    expect(homeSource).not.toMatch(/heroImageHeight/);
  });

  it("keeps the overlay composed template's image slot square", () => {
    for (const file of overlayTemplateFiles) {
      expect(readTemplate(file)).toMatch(/aspectRatio: 1/);
    }
  });

  it("shows the whole poster at 3:2 on every text-below composed feed card", () => {
    for (const file of textBelowTemplateFiles) {
      const source = readTemplate(file);
      expect(source, `${file} image slot`).toMatch(/aspectRatio: 3 \/ 2/);
      expect(source, `${file} contain fit`).toMatch(/fit=\{surface === "consumer_feed"/);
    }
  });
});
