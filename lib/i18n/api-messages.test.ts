import { describe, expect, it } from "vitest";
import i18n from "./config";
import { translateApiError, translateKnownApiMessage } from "./api-messages";

/** Every locale's generic mask — the thing a real, actionable error must never become. */
const GENERIC_MASK: Record<string, string> = {
  en: "Something went wrong. Try again.",
  es: "Algo salió mal. Inténtalo de nuevo.",
  ko: "문제가 발생했습니다. 다시 시도하세요.",
};

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

  it("maps the legacy app-wide active claim wording in English", async () => {
    // Kept mapped so an older deployed claim-deal build still translates. The
    // copy it resolves to is the current one-deal-at-a-time wording.
    await i18n.changeLanguage("en");
    const t = i18n.t.bind(i18n);
    expect(
      translateKnownApiMessage(
        "You already have an active claim. Redeem it or wait until it expires before claiming another deal.",
        t,
      ),
    ).toBe("You can only claim one deal at a time. Redeem or release the deal in your wallet first.");
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

  it("maps the business-application 429 in every locale", async () => {
    // F-08: submit-business-application's flood ceiling returns this exact
    // string, which invokeErrorMessage rethrows verbatim. Unmapped, es/ko
    // applicants got either English or the generic mask on a real rate limit.
    const raw = "Too many requests. Please try again later.";
    const expected: Record<string, string> = {
      en: "Too many requests. Wait a moment and try again.",
      es: "Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.",
      ko: "요청이 너무 많습니다. 잠시 후 다시 시도하세요.",
    };
    for (const [locale, copy] of Object.entries(expected)) {
      await i18n.changeLanguage(locale);
      expect(translateKnownApiMessage(raw, i18n.t.bind(i18n))).toBe(copy);
    }
    await i18n.changeLanguage("en");
  });
});

/**
 * Regression guard for the "second claim shows Something went wrong" bug: the
 * server reworded CUSTOMER_ALREADY_HAS_ACTIVE_DEAL and the copy table wasn't
 * updated, so a real, actionable blocker was masked as a generic failure.
 */
describe("claim blockers never degrade to the generic mask", () => {
  const CLAIM_BLOCKER_MESSAGES = [
    "You already have an active deal in your wallet. Redeem it, let it expire, or release it before claiming another.",
    "This business limits deals to first-time Twofer customers. You have already redeemed a deal here.",
    "This deal is not eligible to claim.",
    "This business is not accepting new deal claims.",
    "This deal has reached its claim limit.",
  ];

  const CLAIM_BLOCKER_CODES = [
    "CUSTOMER_ALREADY_HAS_ACTIVE_DEAL",
    "BUSINESS_REPEAT_LIMIT_FOREVER",
    "BUSINESS_REPEAT_LIMIT_COOLDOWN",
    "DEAL_NOT_ELIGIBLE",
    "BUSINESS_NEW_CLAIMS_DISABLED",
  ];

  it("translates every claim-deal blocker string in every locale", async () => {
    for (const locale of ["en", "es", "ko"]) {
      await i18n.changeLanguage(locale);
      const t = i18n.t.bind(i18n);
      for (const raw of CLAIM_BLOCKER_MESSAGES) {
        const out = translateKnownApiMessage(raw, t);
        expect(out, `${locale} / ${raw}`).not.toBe(GENERIC_MASK[locale]);
        expect(out, `${locale} / ${raw}`).not.toMatch(/^apiErrors\./);
      }
    }
    await i18n.changeLanguage("en");
  });

  it("translates every claim-deal blocker code in every locale", async () => {
    for (const locale of ["en", "es", "ko"]) {
      await i18n.changeLanguage(locale);
      const t = i18n.t.bind(i18n);
      for (const code of CLAIM_BLOCKER_CODES) {
        const out = translateApiError({ code, message: "" }, t);
        expect(out, `${locale} / ${code}`).not.toBe(GENERIC_MASK[locale]);
        expect(out, `${locale} / ${code}`).not.toMatch(/^apiErrors\./);
      }
    }
    await i18n.changeLanguage("en");
  });

  it("uses the error_code when the backend reworded the message", async () => {
    await i18n.changeLanguage("en");
    const t = i18n.t.bind(i18n);
    const out = translateApiError(
      { code: "CUSTOMER_ALREADY_HAS_ACTIVE_DEAL", message: "Some brand new wording nobody mapped yet" },
      t,
    );
    expect(out).toBe("You can only claim one deal at a time. Redeem or release the deal in your wallet first.");
  });

  it("still prefers the message when it carries data the code cannot", async () => {
    await i18n.changeLanguage("en");
    const t = i18n.t.bind(i18n);
    // A coded error whose message is the interpolating cutoff form: the time has
    // to survive, so the message branch must win over the code branch.
    const out = translateApiError(
      { code: "DEAL_NOT_ELIGIBLE", message: "Claiming has closed. Cutoff was Mon, 3:00 PM" },
      t,
    );
    expect(out).toContain("Mon, 3:00 PM");
  });

  it("renders the repeat cooldown as a readable date, never a raw ISO", async () => {
    for (const locale of ["en", "es", "ko"]) {
      await i18n.changeLanguage(locale);
      const t = i18n.t.bind(i18n);
      const raw = "You can claim another deal from this business on 2026-08-01T14:00:00.000Z.";
      const out = translateApiError({ code: "BUSINESS_REPEAT_LIMIT_COOLDOWN", message: raw }, t);
      expect(out, locale).not.toBe(GENERIC_MASK[locale]);
      expect(out, locale).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(out, locale).not.toBe(raw);
    }
    await i18n.changeLanguage("en");
  });

  it("falls back to date-less cooldown copy when the timestamp is unparsable", async () => {
    await i18n.changeLanguage("en");
    const t = i18n.t.bind(i18n);
    const out = translateApiError(
      { code: "BUSINESS_REPEAT_LIMIT_COOLDOWN", message: "You can claim another deal from this business on soon." },
      t,
    );
    expect(out).toBe("You've recently redeemed a deal here. Check back soon.");
  });

  it("still masks genuinely unknown errors even with an unknown code", async () => {
    await i18n.changeLanguage("en");
    const t = i18n.t.bind(i18n);
    expect(translateApiError({ code: "SOME_NEW_CODE", message: "Totally custom backend text" }, t)).toBe(
      "Something went wrong. Try again.",
    );
  });
});
