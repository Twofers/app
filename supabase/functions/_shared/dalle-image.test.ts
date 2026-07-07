import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "supabase", "functions", "_shared", "dalle-image.ts"), "utf8");

describe("buildPhotoAdImagePrompt", () => {
  it("rejects a gpt-image-2 generate-model secret and falls back to gpt-image-1", async () => {
    // gpt-image-2 is intentionally NOT allowlisted: in prod it fails every
    // request with FETCH_ERROR (hangs to the per-call timeout) and burns the
    // image budget. When the dashboard secret points at it we must fall through
    // to the known-good gpt-image-1 instead of selecting it.
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

    expect(RESOLVED_IMAGE_GENERATE_MODEL).toBe("gpt-image-1");
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
      creativeDirection: "Warm morning coffee break with the bagel and coffee framed for poster text.",
    });

    expect(prompt).toMatch(/bagel/i);
    expect(prompt).toMatch(/coffee/i);
    expect(prompt).toMatch(/Selected ad concept for composition only/i);
    expect(prompt).toMatch(/Warm morning coffee break/i);
    expect(prompt).toMatch(/Show all required items/i);
    expect(prompt).toMatch(/Do not show only one item/i);
    expect(prompt).toMatch(/no text/i);
    expect(prompt).toMatch(/logos/i);
    expect(prompt).toMatch(/center-safe area/i);
    expect(prompt).toMatch(/native offer text overlays/i);
  });

  it("can request vertical poster-ready framing while keeping images text-free", async () => {
    Object.defineProperty(globalThis, "Deno", {
      configurable: true,
      value: { env: { get: () => "gpt-image-1" } },
    });
    const cacheBust = `./dalle-image.ts?poster=${Date.now()}`;
    const { buildPhotoAdImagePrompt } = await import(cacheBust);

    const prompt = buildPhotoAdImagePrompt({
      itemName: "latte",
      businessName: "Test Cafe",
      aspectRatio: "4:5",
    });

    expect(prompt).toMatch(/Vertical 4:5 poster-ready framing/i);
    expect(prompt).toMatch(/Absolutely no text/i);
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

describe("OpenAI image edit custom instruction source guard", () => {
  it("appends bounded custom edit instructions without dropping preset guardrails", () => {
    expect(source).toMatch(/function treatmentPrompt\(treatment: PhotoTreatment, customEditInstruction\?: string\)/);
    expect(source).toMatch(/Merchant bounded custom edit instruction/);
    expect(source).toMatch(/Do not add text, prices, discounts, coupons, QR codes, logos/);
    expect(source).toMatch(/Do not remove, replace, or materially change the paid item/);
    expect(source).toMatch(/form\.append\("prompt", treatmentPrompt\(treatment, params\.customEditInstruction\)\)/);
  });
});
