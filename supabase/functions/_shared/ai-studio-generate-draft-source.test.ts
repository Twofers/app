import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-studio-generate-draft", "index.ts"),
  "utf8",
);
const imageProviderSource = readFileSync(
  join(process.cwd(), "supabase", "functions", "_shared", "ai-image-provider.ts"),
  "utf8",
);

describe("ai-studio-generate-draft source guard", () => {
  it("requests Gemini images in the same 4:5 ratio used by the native preview", () => {
    expect(imageProviderSource).toMatch(/AiImageAspectRatio = "1:1" \| "4:3" \| "16:9" \| "4:5"/);
    expect(source).toMatch(/aspectRatio:\s*"4:5"/);
  });

  it("keeps the dev draft poster-first and source/rendered asset contract explicit", () => {
    expect(source).toMatch(/kicker:\s*\{\s*type:\s*"string"\s*\}/);
    expect(source).toMatch(/offer_line_1:\s*\{\s*type:\s*"string"\s*\}/);
    expect(source).toMatch(/composition_plan/);
    expect(source).toMatch(/source_asset_path:\s*draft\.image_asset_path/);
    expect(source).toMatch(/rendered_asset_path:\s*null/);
    expect(source).toMatch(/DEFAULT_CTA = ""/);
    expect(source).toMatch(/Never use the word Twofer in any poster field/);
    expect(source).toMatch(/scarcityLabel:\s*""/);
  });
});
