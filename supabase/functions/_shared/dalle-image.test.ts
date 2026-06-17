import { describe, expect, it } from "vitest";

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
