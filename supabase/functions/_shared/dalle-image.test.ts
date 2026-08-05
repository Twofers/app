import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(join(process.cwd(), "supabase", "functions", "_shared", "dalle-image.ts"), "utf8");

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Minimal valid PNG: signature + an IHDR chunk carrying real width/height at the
 * standard offsets (16-23). No IDAT/IEND/CRC — `readPngDimensions` in dalle-image.ts
 * only inspects the first 24 bytes, so this is sufficient for aspect telemetry tests
 * without a full pixel-valid PNG.
 */
function fakePngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function fakePngBase64(width: number, height: number): string {
  return btoa(String.fromCharCode(...fakePngBytes(width, height)));
}

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

  it("is byte-identical to the pre-v4 prompt when opts is omitted", async () => {
    // Captured from the prompt builder before the v4 promptVariant existed, using
    // this exact input. Pins that omitting opts (every existing caller) never
    // changes a single character of the emitted prompt.
    Object.defineProperty(globalThis, "Deno", {
      configurable: true,
      value: { env: { get: () => "gpt-image-1" } },
    });
    const cacheBust = `./dalle-image.ts?byteident=${Date.now()}`;
    const { buildPhotoAdImagePrompt } = await import(cacheBust);

    const prompt = buildPhotoAdImagePrompt({
      itemName: "bagel and coffee",
      itemDescription: "A bagel paired with a cup of coffee.",
      businessName: "Test Cafa",
      requiredVisualItems: ["bagel", "coffee"],
      creativeDirection: "Warm morning coffee break with the bagel and coffee framed for poster text.",
      aspectRatio: "4:5",
    });

    expect(prompt).toBe(
      [
        "Required offer items: bagel, coffee. Show all required items together as equally important main subjects. Do not show only one item.",
        "Editorial food photography — photoreal bagel and coffee as the single hero subject.",
        "Description: A bagel paired with a cup of coffee..",
        "For an independent cafe called Test Cafa.",
        "Selected ad concept for composition only, never render as text: Warm morning coffee break with the bagel and coffee framed for poster text..",
        "Natural soft daylight, realistic textures and cast shadows, true-to-life proportions, high fine detail, clean composition, shallow depth of field.",
        "Cafe surface backdrop — light wood, marble, or matte ceramic — uncluttered.",
        "Honest, appetizing, magazine-quality — not stocky, not illustrated, not a CGI render.",
        "Keep every required item fully inside the center-safe area and away from crop edges.",
        "Leave clean visual space near the top or bottom for native offer text overlays; keep those zones calm enough for contrast.",
        "Absolutely no text, letters, numbers, prices, coupons, discount copy, menu boards, signage, banners, overlays, QR codes, barcodes, logos, fake logos, brand marks, watermarks, mascots, cartoon characters, animals, or unrelated prop characters.",
        "No human faces, no hands holding the item.",
        "Vertical 4:5 poster-ready framing that fills the whole frame edge to edge (no borders, letterboxing, or flat color bands), with the product centered and calmer photographic zones top and bottom for native text.",
      ].join(" "),
    );
  });

  it("v4 variant drops the letterboxing-prone 'Leave clean visual space' line and states zone fractions instead", async () => {
    Object.defineProperty(globalThis, "Deno", {
      configurable: true,
      value: { env: { get: () => "gpt-image-1" } },
    });
    const cacheBust = `./dalle-image.ts?v4zone=${Date.now()}`;
    const { buildPhotoAdImagePrompt } = await import(cacheBust);

    const prompt = buildPhotoAdImagePrompt(
      { itemName: "latte", businessName: "Test Cafe", aspectRatio: "4:5" },
      { promptVariant: "v4", businessCategory: "coffee shop" },
    );

    expect(prompt).not.toContain("Leave clean visual space");
    expect(prompt).toContain("generated 2:3 frame, before the app's center-crop to 4:5");
    expect(prompt).toMatch(/top 29% of the frame/);
    expect(prompt).toMatch(/29% to 63% of the frame height/);
    expect(prompt).toMatch(/bottom 37% of the frame/);
  });

  it("v4 variant keeps food framing for a food category and still forbids letterboxing wording", async () => {
    Object.defineProperty(globalThis, "Deno", {
      configurable: true,
      value: { env: { get: () => "gpt-image-1" } },
    });
    const cacheBust = `./dalle-image.ts?v4food=${Date.now()}`;
    const { buildPhotoAdImagePrompt } = await import(cacheBust);

    const prompt = buildPhotoAdImagePrompt(
      { itemName: "latte", businessName: "Test Cafe", aspectRatio: "4:5" },
      { promptVariant: "v4", businessCategory: "coffee shop" },
    );

    expect(prompt).toContain("Editorial food photography — photoreal latte as the single hero subject.");
    expect(prompt).toContain("Cafe surface backdrop");
    expect(prompt).toContain("For an independent cafe called Test Cafe.");
  });

  it("v4 variant gives a non-food category commercial-photography framing instead of cafe/food language", async () => {
    Object.defineProperty(globalThis, "Deno", {
      configurable: true,
      value: { env: { get: () => "gpt-image-1" } },
    });
    const cacheBust = `./dalle-image.ts?v4nonfood=${Date.now()}`;
    const { buildPhotoAdImagePrompt } = await import(cacheBust);

    const prompt = buildPhotoAdImagePrompt(
      { itemName: "haircut kit", businessName: "Test Salon", aspectRatio: "4:5" },
      { promptVariant: "v4", businessCategory: "hair salon", visualDirection: "bright modern salon chair" },
    );

    expect(prompt).toContain("Editorial commercial photography — photoreal haircut kit as the single hero subject for a hair salon business.");
    expect(prompt).not.toContain("Editorial food photography");
    expect(prompt).not.toContain("Cafe surface backdrop");
    expect(prompt).not.toContain("For an independent cafe called");
    expect(prompt).toContain("For a hair salon business called Test Salon.");
    expect(prompt).toContain("Backdrop matching the setting: bright modern salon chair");
  });

  it("v4 variant falls back to legacy food framing when no category is given", async () => {
    Object.defineProperty(globalThis, "Deno", {
      configurable: true,
      value: { env: { get: () => "gpt-image-1" } },
    });
    const cacheBust = `./dalle-image.ts?v4nocategory=${Date.now()}`;
    const { buildPhotoAdImagePrompt } = await import(cacheBust);

    const prompt = buildPhotoAdImagePrompt(
      { itemName: "latte", businessName: "Test Cafe", aspectRatio: "4:5" },
      { promptVariant: "v4" },
    );

    expect(prompt).toContain("Editorial food photography — photoreal latte as the single hero subject.");
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

  it("caps image calls and model fallback with the request image deadline", () => {
    expect(source).toMatch(/type AiImageDeadline/);
    expect(source).toMatch(/latencyMs:\s*number/);
    expect(source).toMatch(/aiImageAttemptTimeoutMs\(deadline,\s*timeoutLeg,\s*IMAGE_CALL_TIMEOUT_MS\)/);
    expect(source).toMatch(/shouldRetryAiImageAttempt\(firstAttempt,\s*deadline,\s*20_000\)/);
    expect(source).toMatch(/canSpendAiImageDeadline\(deadline,\s*"openai_model_fallback",\s*35_000\)/);
    expect(source).toMatch(/"OpenAI image generation skipped because the request deadline was nearly exhausted."/);
    expect(source).toMatch(/"OpenAI image edit skipped because the request deadline was nearly exhausted."/);
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

describe("generatePhotoAdImageWithTelemetry aspect telemetry", () => {
  it("records actual width/height/aspect and no mismatch when the image matches the requested gpt-image-1 size", async () => {
    Object.defineProperty(globalThis, "Deno", {
      configurable: true,
      value: { env: { get: () => "gpt-image-1" } },
    });
    const cacheBust = `./dalle-image.ts?aspectmatch=${Date.now()}`;
    const { generatePhotoAdImageWithTelemetry } = await import(cacheBust);

    // gpt-image-1 generate requests always ask for 1024x1536 (2:3) — see the `size`
    // comment in attemptImageGeneration. Returning exactly that shape should record
    // no mismatch.
    const pngBase64 = fakePngBase64(1024, 1536);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: pngBase64 }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await generatePhotoAdImageWithTelemetry("test-openai-key", "Create a product photo.", "test_tag");

    expect(result.bytes).not.toBeNull();
    expect(result.attempts[0]?.actualWidth).toBe(1024);
    expect(result.attempts[0]?.actualHeight).toBe(1536);
    expect(result.attempts[0]?.actualAspect).toBe("2:3");
    expect(result.attempts[0]?.aspectMismatch).toBe(false);
  });

  it("flags aspectMismatch when the returned image does not match the requested size", async () => {
    Object.defineProperty(globalThis, "Deno", {
      configurable: true,
      value: { env: { get: () => "gpt-image-1" } },
    });
    const cacheBust = `./dalle-image.ts?aspectmismatch=${Date.now()}`;
    const { generatePhotoAdImageWithTelemetry } = await import(cacheBust);

    // Square 1024x1024 back from a request that asked for portrait 1024x1536 — a
    // real provider deviation, not the deliberate/expected 2:3-vs-4:5 poster gap.
    const pngBase64 = fakePngBase64(1024, 1024);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: pngBase64 }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await generatePhotoAdImageWithTelemetry("test-openai-key", "Create a product photo.", "test_tag");

    expect(result.attempts[0]?.actualWidth).toBe(1024);
    expect(result.attempts[0]?.actualHeight).toBe(1024);
    expect(result.attempts[0]?.actualAspect).toBe("1:1");
    expect(result.attempts[0]?.aspectMismatch).toBe(true);
    // Telemetry only — a mismatch never turns a successful decode into a failure.
    expect(result.bytes).not.toBeNull();
  });
});
