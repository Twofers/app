import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "supabase", "functions", "_shared", "dalle-image.ts"), "utf8");

describe("buildPhotoAdImagePrompt", () => {
  it("allows the hosted generate model secret to select gpt-image-2", async () => {
    Object.defineProperty(globalThis, "Deno", {
      configurable: true,
      value: {
        env: {
          get: (name: string) => name === "OPENAI_IMAGE_MODEL_GENERATE" ? "gpt-image-2" : "gpt-image-1",
        },
      },
    });
    const cacheBust = `./dalle-image.ts?model=${Date.now()}`;
    const { RESOLVED_IMAGE_GENERATE_MODEL } = await import(cacheBust);

    expect(RESOLVED_IMAGE_GENERATE_MODEL).toBe("gpt-image-2");
  });

  it("includes every required visual item for mixed-item offers", async () => {
    Object.defineProperty(globalThis, "Deno", {
      configurable: true,
      value: { env: { get: () => "gpt-image-1" } },
    });
    const cacheBust = `./dalle-image.ts?prompt=${Date.now()}`;
    const { buildPhotoAdImagePrompt } = await import(cacheBust);

    const prompt = buildPhotoAdImagePrompt({
      itemName: "bagel and coffee",
      itemDescription: "A bagel paired with a cup of coffee.",
      businessName: "Test Cafa",
      requiredVisualItems: ["bagel", "coffee"],
    });

    expect(prompt).toMatch(/bagel/i);
    expect(prompt).toMatch(/coffee/i);
    expect(prompt).toMatch(/Show all required items/i);
    expect(prompt).toMatch(/Do not show only one item/i);
    expect(prompt).toMatch(/no text/i);
    expect(prompt).toMatch(/logos/i);
  });
});

describe("OpenAI image provider failure telemetry source guard", () => {
  it("does not log or store raw upstream response bodies", () => {
    expect(source).toMatch(/event:\s*"image_gen_http"/);
    expect(source).toMatch(/event:\s*"enhance_http"/);
    expect(source).toMatch(/OpenAI image generation failed with/);
    expect(source).toMatch(/OpenAI image edit failed with/);
    expect(source).toMatch(/OpenAI image generation failed before a usable response was returned/);
    expect(source).toMatch(/OpenAI image edit failed before a usable response was returned/);
    expect(source).not.toMatch(/body:\s*errBody/);
    expect(source).not.toMatch(/err:\s*String\(e\)/);
    expect(source).not.toMatch(/errorMessage:\s*String\(e\)\.slice/);
    expect(source).not.toMatch(/errorMessage:\s*errBody\.slice/);
    expect(source).not.toMatch(/await res\.text\(\)/);
  });
});
