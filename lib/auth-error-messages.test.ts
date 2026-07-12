import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import {
  friendlyAuthError,
  friendlyAuthMessage,
  isEmailNotConfirmedError,
} from "@/lib/auth-error-messages";

// The module under test is pure: every function takes an error object plus the
// i18next `t` translator and returns a string, with no I/O or side effects.
// A pass-through `t` (returns the key) makes assertions locale-independent — we
// verify WHICH message key is chosen, not the English copy, which lives in the
// locale files and is tested elsewhere.
const t = ((key: string) => key) as unknown as TFunction;

describe("friendlyAuthError — signup errors", () => {
  // app/auth-landing.tsx routes supabase.auth.signUp({...}) errors through
  // friendlyAuthError(error, t).

  it("maps a 429 rate-limited signup to the rate-limited copy", () => {
    expect(
      friendlyAuthError({ message: "Email rate limit exceeded", status: 429 }, t)
    ).toBe("auth.errRateLimited");
  });

  it("maps the GoTrue over_email_send_rate_limit code (no HTTP status) to rate-limited copy", () => {
    expect(
      friendlyAuthError({ message: "", code: "over_email_send_rate_limit" }, t)
    ).toBe("auth.errRateLimited");
  });

  it("falls back to errGeneric when the error object is null/undefined", () => {
    expect(friendlyAuthError(null, t)).toBe("auth.errGeneric");
    expect(friendlyAuthError(undefined, t)).toBe("auth.errGeneric");
  });

  it("passes an unrecognized signup message through verbatim (current behavior)", () => {
    // e.g. "User already registered", weak-password copy, etc. are not specially
    // mapped today; the raw upstream message is surfaced. Documents actual behavior.
    expect(
      friendlyAuthError({ message: "User already registered", status: 422 }, t)
    ).toBe("User already registered");
  });

  it("returns errGeneric when an error is present but carries no message", () => {
    expect(friendlyAuthError({ message: "", status: 400 }, t)).toBe("auth.errGeneric");
  });
});

describe("friendlyAuthError — resend-confirmation cooldown", () => {
  // app/auth-landing.tsx routes supabase.auth.resend({...}) errors through
  // friendlyAuthError(error, t). Hitting resend during the cooldown window
  // surfaces GoTrue's email-send rate limit, which must become the calm
  // "too many attempts, wait" copy — not a raw upstream string.

  it("maps HTTP 429 on resend to the rate-limited copy", () => {
    expect(
      friendlyAuthError(
        { message: "For security purposes, you can only request this after 60 seconds.", status: 429 },
        t
      )
    ).toBe("auth.errRateLimited");
  });

  it("maps the over_email_send_rate_limit code to the rate-limited copy", () => {
    expect(
      friendlyAuthError({ message: "over_email_send_rate_limit", code: "over_email_send_rate_limit" }, t)
    ).toBe("auth.errRateLimited");
  });

  it("detects a spaced 'rate limit' phrase in the message", () => {
    expect(
      friendlyAuthError({ message: "Email rate limit exceeded" }, t)
    ).toBe("auth.errRateLimited");
  });

  it("detects a rate_limit token embedded in the code even without a status", () => {
    expect(
      friendlyAuthError({ message: "please slow down", code: "email_rate_limit" }, t)
    ).toBe("auth.errRateLimited");
  });
});

describe("friendlyAuthError / friendlyAuthMessage — email-not-confirmed path", () => {
  // From a recent fix batch: an unconfirmed account trying to log in must be
  // told to confirm their email (which reveals the resend action), rather than
  // seeing a generic or invalid-credentials error.

  it("maps the 'Email not confirmed' message to errEmailNotConfirmed", () => {
    expect(
      friendlyAuthError({ message: "Email not confirmed", status: 400 }, t)
    ).toBe("auth.errEmailNotConfirmed");
  });

  it("maps the email_not_confirmed code to errEmailNotConfirmed", () => {
    expect(
      friendlyAuthError({ message: "", code: "email_not_confirmed", status: 400 }, t)
    ).toBe("auth.errEmailNotConfirmed");
  });

  it("friendlyAuthMessage also maps the message form directly", () => {
    expect(friendlyAuthMessage("Email not confirmed", t)).toBe("auth.errEmailNotConfirmed");
  });

  it("friendlyAuthMessage maps the code form directly", () => {
    expect(friendlyAuthMessage("", t, "email_not_confirmed")).toBe("auth.errEmailNotConfirmed");
  });

  it("does not confuse invalid credentials with the unconfirmed path", () => {
    expect(
      friendlyAuthError({ message: "Invalid login credentials", status: 400 }, t)
    ).toBe("auth.errInvalidCredentials");
  });

  it("rate-limit takes precedence over other branches", () => {
    // A 429 short-circuits before the message is inspected.
    expect(
      friendlyAuthError({ message: "Email not confirmed", status: 429 }, t)
    ).toBe("auth.errRateLimited");
  });
});

describe("isEmailNotConfirmedError", () => {
  it("is true for the message form", () => {
    expect(isEmailNotConfirmedError({ message: "Email not confirmed" })).toBe(true);
  });

  it("is true for the code form (case-insensitive)", () => {
    expect(isEmailNotConfirmedError({ code: "EMAIL_NOT_CONFIRMED" })).toBe(true);
  });

  it("is false for unrelated errors and for null/undefined", () => {
    expect(isEmailNotConfirmedError({ message: "Invalid login credentials" })).toBe(false);
    expect(isEmailNotConfirmedError(null)).toBe(false);
    expect(isEmailNotConfirmedError(undefined)).toBe(false);
  });
});

describe("friendlyAuthMessage — remaining branches", () => {
  it("maps invalid-credentials variants", () => {
    expect(friendlyAuthMessage("Invalid login credentials", t)).toBe("auth.errInvalidCredentials");
    expect(friendlyAuthMessage("Invalid email or password", t)).toBe("auth.errInvalidCredentials");
    expect(friendlyAuthMessage("User not found", t)).toBe("auth.errInvalidCredentials");
  });

  it("maps network errors", () => {
    expect(friendlyAuthMessage("Network request failed", t)).toBe("auth.errNetwork");
  });

  it("passes an unknown non-empty message through, and empty -> errGeneric", () => {
    expect(friendlyAuthMessage("Something oddly specific", t)).toBe("Something oddly specific");
    expect(friendlyAuthMessage("", t)).toBe("auth.errGeneric");
  });
});
