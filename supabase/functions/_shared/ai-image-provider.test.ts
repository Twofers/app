import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildGeminiAdImagePrompt,
  generateGeminiAdImageWithTelemetry,
  resolveAiImageProviderConfig,
  resolveGeminiImageModel,
} from "./ai-image-provider.ts";

function env(values: Record<string, string | undefined>) {
  return {
    get(name: string) {
      return values[name];
    },
  };
}

const source = readFileSync(join(process.cwd(), "supabase", "functions", "_shared", "ai-image-provider.ts"), "utf8");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveAiImageProviderConfig", () => {
  it("keeps OpenAI primary unless Gemini is explicitly enabled", () => {
    const config = resolveAiImageProviderConfig(env({ AI_IMAGE_PROVIDER: "gemini" }));

    expect(config.configuredPrimaryProvider).toBe("gemini");
    expect(config.primaryProvider).toBe("openai");
    expect(config.fallbackProvider).toBe("openai");
    expect(config.geminiEnabled).toBe(false);
  });

  it("enables Gemini behind the feature flag with the stable model", () => {
    const config = resolveAiImageProviderConfig(
      env({
        AI_IMAGE_PROVIDER: "gemini",
        AI_IMAGE_GEMINI_ENABLED: "true",
        AI_IMAGE_FALLBACK_PROVIDER: "openai",
        GEMINI_IMAGE_MODEL: "gemini-3.1-flash-image",
        GEMINI_IMAGE_ESTIMATED_COST_1K_USD: "0.067",
      }),
    );

    expect(config.primaryProvider).toBe("gemini");
    expect(config.fallbackProvider).toBe("openai");
    expect(config.geminiModel).toBe("gemini-3.1-flash-image");
    expect(config.geminiEstimatedCost1KUsd).toBe(0.067);
  });
});

describe("resolveGeminiImageModel", () => {
  it("falls back from unlisted model IDs", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(resolveGeminiImageModel(env({ GEMINI_IMAGE_MODEL: "gemini-made-up" }))).toBe(
      "gemini-3.1-flash-image",
    );
    expect(warn).toHaveBeenCalled();
  });
});

describe("buildGeminiAdImagePrompt", () => {
  it("keeps Gemini responsible for the image only", () => {
    const prompt = buildGeminiAdImagePrompt({
      businessId: "business-1",
      businessName: "Mango Cafe",
      businessCategory: "coffee shop",
      offerTitle: "Buy one latte, get one croissant free",
      paidItem: "latte",
      freeItem: "croissant",
      dealType: "SAME_ITEM_BOGO",
      creativeDirection: "Cozy afternoon cafe table with space for poster text.",
      stylePreset: "playful-twofer",
      aspectRatio: "1:1",
      imageSize: "1K",
    });

    expect(prompt).toContain("Required visible items: latte, croissant.");
    expect(prompt).toContain("Selected AI ad concept for composition only");
    expect(prompt).toContain("Cozy afternoon cafe table");
    expect(prompt).toContain("Do not add readable text.");
    expect(prompt).toContain("generated image must be text-free");
    expect(prompt).toContain("Do not add fake business names.");
    expect(prompt).toContain("Do not add app mascots, characters, animals, penguins");
    expect(prompt).toContain("center-safe area");
    // P1 (2026-07-20): full-bleed framing replaced the old "leave clean visual space" /
    // "top and bottom overlay zones" wording that made the model letterbox two-item posters.
    expect(prompt).toContain("Fill the whole vertical frame edge to edge");
    expect(prompt).toContain("never empty bands");
    expect(prompt).toContain("The final headline, business name, CTA, quantity, expiration, and offer terms");
  });

  it("genericizeItems drops evocative brand tokens so a refused prompt can retry safely (F4)", () => {
    const generic = buildGeminiAdImagePrompt(
      {
        businessId: "business-1",
        businessName: "The Colonel's Brew",
        businessCategory: "coffee shop",
        offerTitle: "Buy one THE SERGEANT'S STRIPES, get one free",
        paidItem: "THE SERGEANT'S STRIPES (Select origins estate grown coffee)",
        freeItem: "THE SERGEANT'S STRIPES (Select origins estate grown coffee)",
        dealType: "SAME_ITEM_BOGO",
        creativeDirection: "A rugged military-camp coffee scene with sergeant stripes.",
        stylePreset: "playful-twofer",
        aspectRatio: "4:5",
        imageSize: "1K",
      },
      { genericizeItems: true },
    );

    // No brand tokens a provider safety classifier can read literally.
    expect(generic).not.toMatch(/sergeant/i);
    expect(generic).not.toMatch(/colonel/i);
    expect(generic).not.toMatch(/military/i);
    // Asks for the business-category product instead, and keeps every text-free rule.
    expect(generic).toContain("coffee shop product");
    expect(generic).toContain("generated image must be text-free");
    expect(generic).toContain("Do not add readable text.");

    // The default (branded) prompt still carries the item name — so genericize changed it.
    const branded = buildGeminiAdImagePrompt({
      businessId: "business-1",
      businessName: "The Colonel's Brew",
      businessCategory: "coffee shop",
      offerTitle: "Buy one THE SERGEANT'S STRIPES, get one free",
      paidItem: "THE SERGEANT'S STRIPES (Select origins estate grown coffee)",
      freeItem: "THE SERGEANT'S STRIPES (Select origins estate grown coffee)",
      dealType: "SAME_ITEM_BOGO",
      stylePreset: "playful-twofer",
      aspectRatio: "4:5",
      imageSize: "1K",
    });
    expect(branded).toMatch(/sergeant/i);
  });

  it("uses poster-ready framing for native poster mode without app branding in image mechanics fallback", () => {
    const prompt = buildGeminiAdImagePrompt({
      businessId: "business-1",
      businessName: "",
      businessCategory: "bakery",
      offerTitle: "",
      stylePreset: "premium-cafe",
      aspectRatio: "4:5",
      imageSize: "1K",
    });

    expect(prompt).toContain("vertical 4:5 poster-ready framing");
    expect(prompt).toContain("local BOGO deal");
    expect(prompt).not.toContain("Twofer local BOGO deal");
  });

  it("includes bounded merchant custom edit instructions without relaxing image rules", () => {
    const prompt = buildGeminiAdImagePrompt({
      businessId: "business-1",
      businessName: "Mango Cafe",
      businessCategory: "coffee shop",
      offerTitle: "Buy one latte, get one croissant free",
      paidItem: "latte",
      freeItem: "croissant",
      referenceImages: [{ mimeType: "image/png", base64: "abc" }],
      customEditInstruction: "Make the counter brighter and remove crumbs.",
      stylePreset: "premium-cafe",
      aspectRatio: "1:1",
      imageSize: "1K",
    });

    expect(prompt).toContain("Merchant bounded custom edit instruction");
    expect(prompt).toContain("Make the counter brighter and remove crumbs.");
    expect(prompt).toContain("Do not remove, replace, or materially change the paid item");
    expect(prompt).toContain("Do not add readable text.");
    expect(prompt).toContain("Do not add QR codes.");
  });
});

describe("generateGeminiAdImageWithTelemetry", () => {
  it("does not call Gemini when the API key is missing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await generateGeminiAdImageWithTelemetry({
      apiKey: null,
      model: "gemini-3.1-flash-image",
      prompt: "Create a product photo.",
      retryOnFailure: false,
    });

    expect(result.bytes).toBeNull();
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.errorCode).toBe("MISSING_GEMINI_API_KEY");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses the Interactions API for Gemini 3 image models and parses PNG output", async () => {
    const pngBytes = new TextEncoder().encode("png");
    const pngBase64 = btoa(String.fromCharCode(...pngBytes));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          output_image: {
            mime_type: "image/png",
            data: pngBase64,
          },
          steps: [
            {
              type: "model_output",
              content: [{ type: "image", mime_type: "image/png", data: pngBase64 }],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await generateGeminiAdImageWithTelemetry({
      apiKey: "test-gemini-key",
      model: "gemini-3.1-flash-image",
      prompt: "Create a product photo.",
      aspectRatio: "4:5",
      estimatedCostUsd: 0.067,
    });

    expect(result.bytes).toEqual(pngBytes);
    expect(result.mimeType).toBe("image/png");
    expect(result.estimatedCostUsd).toBe(0.067);
    expect(result.attempts[0]?.endpoint).toBe("interactions.create");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    const request = init as RequestInit;
    expect((request.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-gemini-key");
    const body = JSON.parse(String(request.body));
    expect(body.model).toBe("gemini-3.1-flash-image");
    expect(body.input).toEqual([{ type: "text", text: "Create a product photo." }]);
    expect(body.response_format).toEqual({ type: "image", aspect_ratio: "4:5", image_size: "1K" });
    expect(body.generationConfig).toBeUndefined();
  });

  it("retries the Interactions request without response_format when it is rejected with HTTP 400", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pngBytes = new TextEncoder().encode("png");
    const pngBase64 = btoa(String.fromCharCode(...pngBytes));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 400 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ output_image: { mime_type: "image/png", data: pngBase64 } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const result = await generateGeminiAdImageWithTelemetry({
      apiKey: "test-gemini-key",
      model: "gemini-3.1-flash-image",
      prompt: "Create a product photo.",
      aspectRatio: "4:5",
      retryOnFailure: false,
    });

    expect(result.bytes).toEqual(pngBytes);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body));
    expect(firstBody.response_format).toEqual({ type: "image", aspect_ratio: "4:5", image_size: "1K" });
    expect(secondBody.response_format).toBeUndefined();
    expect(secondBody.input).toEqual(firstBody.input);
    expect(warn).toHaveBeenCalled();
  });

  it("keeps the legacy GenerateContent request for non-Gemini-3 image models", async () => {
    const pngBytes = new TextEncoder().encode("png");
    const pngBase64 = btoa(String.fromCharCode(...pngBytes));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ inlineData: { mimeType: "image/png", data: pngBase64 } }],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await generateGeminiAdImageWithTelemetry({
      apiKey: "test-gemini-key",
      model: "gemini-2.5-flash-image",
      prompt: "Create a product photo.",
      estimatedCostUsd: 0.05,
      retryOnFailure: false,
    });

    expect(result.bytes).toEqual(pngBytes);
    expect(result.attempts[0]?.endpoint).toBe("models.generateContent");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain("/v1/models/gemini-2.5-flash-image:generateContent");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.generationConfig.responseModalities).toEqual(["TEXT", "IMAGE"]);
    expect(body.generationConfig.imageConfig).toEqual({ aspectRatio: "1:1", imageSize: "1K" });
  });
});

describe("Gemini image provider failure telemetry source guard", () => {
  it("does not retain raw upstream response bodies on HTTP failures", () => {
    const failureIndex = source.indexOf("if (!res.ok)");
    const parseIndex = source.indexOf("const json = await res.json()", failureIndex);

    expect(failureIndex).toBeGreaterThan(-1);
    expect(parseIndex).toBeGreaterThan(failureIndex);

    const failureBlock = source.slice(failureIndex, parseIndex);
    expect(failureBlock).toMatch(/normalizeGeminiErrorCode\(res\.status\)/);
    expect(failureBlock).toMatch(/Gemini image generation failed with/);
    expect(failureBlock).not.toMatch(/await res\.text\(\)/);
    expect(failureBlock).not.toMatch(/errorText/);
    expect(failureBlock).not.toMatch(/slice\(0,\s*500\)/);
  });

  it("does not store raw exception text for image fetch or conversion failures", () => {
    expect(source).toMatch(/Gemini image output could not be converted to PNG/);
    expect(source).toMatch(/Gemini image generation failed before a usable response was returned/);
    expect(source).not.toMatch(/errorMessage:\s*String\(error\)\.slice/);
  });
});
