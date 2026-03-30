import { describe, expect, it } from "vitest";
import i18n from "./config";
import { translateKnownApiMessage } from "./api-messages";

describe("translateKnownApiMessage", () => {
  it("maps exact claim-deal string in English", async () => {
    await i18n.changeLanguage("en");
    const t = i18n.t.bind(i18n);
    expect(translateKnownApiMessage("This deal has expired", t)).toBe(
      "This deal has expired",
    );
  });

  it("maps exact claim-deal string in Spanish", async () => {
    await i18n.changeLanguage("es");
    const t = i18n.t.bind(i18n);
    expect(translateKnownApiMessage("This deal has expired", t)).toBe("Esta oferta ha caducado");
  });

  it("maps app-wide active claim string in English", async () => {
    await i18n.changeLanguage("en");
    const t = i18n.t.bind(i18n);
    expect(
      translateKnownApiMessage(
        "You already have an active claim. Redeem it or wait until it expires before claiming another deal.",
        t,
      ),
    ).toBe(
      "You already have an active claim. Redeem it or wait until it expires before claiming another deal.",
    );
  });

  it("maps redeemable-only daily business limit string in English", async () => {
    await i18n.changeLanguage("en");
    const t = i18n.t.bind(i18n);
    const raw =
      "You can only claim once per business per local day while your claim is still redeemable. Redeem it or wait until it expires before claiming another deal from this business.";
    expect(translateKnownApiMessage(raw, t)).toBe(raw);
  });

  it("maps cutoff prefix with interpolated time", async () => {
    await i18n.changeLanguage("en");
    const t = i18n.t.bind(i18n);
    const raw = "Claiming has closed. Cutoff was Mon, 3:00 PM";
    expect(translateKnownApiMessage(raw, t)).toBe("Claiming has closed. Cutoff was Mon, 3:00 PM");
  });

  it("passes through unknown strings", async () => {
    await i18n.changeLanguage("en");
    const t = i18n.t.bind(i18n);
    expect(translateKnownApiMessage("Totally custom backend text", t)).toBe("Totally custom backend text");
  });

  it("maps Postgres-style duplicate key to localized copy", async () => {
    await i18n.changeLanguage("es");
    const t = i18n.t.bind(i18n);
    const raw = 'duplicate key value violates unique constraint "deal_claims_some_key"';
    expect(translateKnownApiMessage(raw, t)).toBe(
      "Esto ya existe. Actualiza e inténtalo de nuevo.",
    );
  });

  it("masks long internal-looking messages", async () => {
    await i18n.changeLanguage("en");
    const t = i18n.t.bind(i18n);
    const raw = "x".repeat(200);
    expect(translateKnownApiMessage(raw, t)).toBe("Something went wrong. Try again.");
  });

  it("maps AI Edge error strings", async () => {
    await i18n.changeLanguage("en");
    const t = i18n.t.bind(i18n);
    expect(translateKnownApiMessage("AI response was invalid JSON.", t)).toBe(
      "AI returned invalid data. Try again.",
    );
  });
});
