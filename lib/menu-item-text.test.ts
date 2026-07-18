import { describe, expect, it } from "vitest";

import { splitMenuItemDescription } from "./menu-item-text";

describe("splitMenuItemDescription", () => {
  it("splits the real prod shape: trailing parenthetical description", () => {
    expect(
      splitMenuItemDescription("the recon roast ( Roaster fresh coffee with a shot of espresso)"),
    ).toEqual({
      name: "the recon roast",
      description: "Roaster fresh coffee with a shot of espresso",
    });
    expect(
      splitMenuItemDescription("the sargents stripes ( select orgin estate grown coffee)"),
    ).toEqual({
      name: "the sargents stripes",
      description: "select orgin estate grown coffee",
    });
  });

  it("keeps short parenthetical qualifiers in the name", () => {
    expect(splitMenuItemDescription("Wings (12 pc)")).toEqual({
      name: "Wings (12 pc)",
      description: null,
    });
    expect(splitMenuItemDescription("Pad Thai (gluten free)")).toEqual({
      name: "Pad Thai (gluten free)",
      description: null,
    });
  });

  it("splits at the last parenthetical when the name itself contains one", () => {
    expect(
      splitMenuItemDescription("Combo (2) (two tacos with rice and beans on the side)"),
    ).toEqual({
      name: "Combo (2)",
      description: "two tacos with rice and beans on the side",
    });
  });

  it("leaves plain names untouched", () => {
    expect(splitMenuItemDescription("Recon Roast")).toEqual({
      name: "Recon Roast",
      description: null,
    });
  });

  it("does not split when the whole string is one parenthetical", () => {
    expect(splitMenuItemDescription("(house made chai with oat milk foam)")).toEqual({
      name: "(house made chai with oat milk foam)",
      description: null,
    });
  });

  it("does not split a mid-string parenthetical", () => {
    expect(splitMenuItemDescription("The (famous house special) Burger")).toEqual({
      name: "The (famous house special) Burger",
      description: null,
    });
  });

  it("trims input and handles non-string defensively", () => {
    expect(splitMenuItemDescription("  Latte  ")).toEqual({ name: "Latte", description: null });
    expect(splitMenuItemDescription(undefined as unknown as string)).toEqual({
      name: "",
      description: null,
    });
  });
});
