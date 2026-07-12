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

  it("maps generic redeem failure fallback in English", async () => {
    await i18n.changeLanguage("en");
    const t = i18n.t.bind(i18n);
    expect(translateKnownApiMessage("Token redemption failed", t)).toBe("Couldn't redeem this ticket.");
  });

  it("masks the bare non-2xx Edge Function wrapper in English", async () => {
    await i18n.changeLanguage("en");
    const t = i18n.t.bind(i18n);
    expect(
      translateKnownApiMessage("Edge Function returned a non-2xx status code", t),
    ).toBe("Something went wrong. Try again.");
  });

  it("never leaks the raw non-2xx wrapper to localized users", async () => {
    for (const lang of ["en", "es", "ko"]) {
      await i18n.changeLanguage(lang);
      const t = i18n.t.bind(i18n);
      const out = translateKnownApiMessage("Edge Function returned a non-2xx status code", t);
      expect(out).not.toMatch(/non-?2xx/i);
      expect(out).not.toMatch(/edge function/i);
    }
  });

  it("masks missing Edge Function infrastructure messages", async () => {
    for (const lang of ["en", "es", "ko"]) {
      await i18n.changeLanguage(lang);
      const t = i18n.t.bind(i18n);
      const out = translateKnownApiMessage("Requested function was not found", t);
      expect(out).not.toMatch(/function was not found/i);
      expect(out).not.toBe("Requested function was not found");
    }
  });

  it("maps cutoff prefix with interpolated time", async () => {
    await i18n.changeLanguage("en");
    const t = i18n.t.bind(i18n);
    const raw = "Claiming has closed. Cutoff was Mon, 3:00 PM";
    expect(translateKnownApiMessage(raw, t)).toBe("Claiming has closed. Cutoff was Mon, 3:00 PM");
  });

  it("masks unknown backend strings", async () => {
    await i18n.changeLanguage("en");
    const t = i18n.t.bind(i18n);
    expect(translateKnownApiMessage("Totally custom backend text", t)).toBe("Something went wrong. Try again.");
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
      "We couldn't prepare ad options. Try again.",
    );
  });
});
