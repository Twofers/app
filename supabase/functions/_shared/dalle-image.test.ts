import { describe, expect, it } from "vitest";

describe("buildPhotoAdImagePrompt", () => {
  it("includes every required visual item for mixed-item offers", async () => {
    Object.defineProperty(globalThis, "Deno", {
      configurable: true,
      value: { env: { get: () => "gpt-image-1" } },
    });
    const { buildPhotoAdImagePrompt } = await import("./dalle-image.ts");

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
