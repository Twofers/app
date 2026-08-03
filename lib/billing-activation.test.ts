import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  platform: { os: "ios" },
}));

vi.mock("./supabase", () => ({
  supabase: {
    functions: { invoke: mocks.invoke },
  },
}));

// billing-activation pulls in ./functions, which reaches react-native/expo.
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return mocks.platform.os;
    },
  },
}));

vi.mock("expo-constants", () => ({
  default: {
    executionEnvironment: "standalone",
    expoConfig: { version: "1.0.0" },
  },
}));

import { createTrialCheckoutUrl, isAllowedStripeCheckoutUrl } from "./billing-activation";

const BUSINESS_ID = "1f0b2b7e-7f4a-4a1e-9c3e-2f5d6a7b8c90";

describe("createTrialCheckoutUrl", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.platform.os = "ios";
  });

  it("returns the Stripe checkout url on success", async () => {
    mocks.invoke.mockResolvedValue({
      data: { checkout_url: "https://checkout.stripe.com/c/pay/cs_test_123", checkout_session_id: "cs_test_123" },
      error: null,
    });

    const result = await createTrialCheckoutUrl(BUSINESS_ID, "es");

    expect(result).toEqual({ ok: true, url: "https://checkout.stripe.com/c/pay/cs_test_123" });
  });

  it("sends business_id and the caller locale, and never a price or source override", async () => {
    mocks.invoke.mockResolvedValue({ data: { checkout_url: "https://checkout.stripe.com/x" }, error: null });

    await createTrialCheckoutUrl(BUSINESS_ID, "ko");

    const [fnName, options] = mocks.invoke.mock.calls[0];
    expect(fnName).toBe("stripe-create-checkout-session");
    expect(options.body).toEqual({ business_id: BUSINESS_ID, source: "native_ios", locale: "ko" });
    // The server resolves price and trial length; the only source marker the
    // client may send is its own platform's dedicated, kill-switched path.
    expect(options.body).not.toHaveProperty("price_id");
    expect(options.body.source).toBe("native_ios");
    expect(options.body).not.toHaveProperty("billing_token");
  });

  it("omits locale when the caller has none", async () => {
    mocks.invoke.mockResolvedValue({ data: { checkout_url: "https://checkout.stripe.com/x" }, error: null });

    await createTrialCheckoutUrl(BUSINESS_ID);

    expect(mocks.invoke.mock.calls[0][1].body).toEqual({ business_id: BUSINESS_ID, source: "native_ios" });
  });

  it("surfaces the server error body instead of throwing", async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: {
        context: new Response(
          JSON.stringify({ error: "Trial activation is not available yet.", error_code: "APPROVED_ACTIVATION_GATE_DISABLED" }),
          { status: 503 },
        ),
      },
    });

    const result = await createTrialCheckoutUrl(BUSINESS_ID);

    expect(result).toEqual({
      ok: false,
      message: "Trial activation is not available yet.",
      code: "APPROVED_ACTIVATION_GATE_DISABLED",
    });
  });

  it("treats a 2xx body carrying an error field as a failure", async () => {
    mocks.invoke.mockResolvedValue({ data: { error: "Forbidden." }, error: null });

    const result = await createTrialCheckoutUrl(BUSINESS_ID);

    expect(result.ok).toBe(false);
  });

  it("fails closed when the response has no checkout url", async () => {
    mocks.invoke.mockResolvedValue({ data: { checkout_session_id: "cs_test_1" }, error: null });

    const result = await createTrialCheckoutUrl(BUSINESS_ID);

    expect(result.ok).toBe(false);
  });

  it("does not throw when the invoke call itself rejects", async () => {
    mocks.invoke.mockRejectedValue(new Error("network down"));

    const result = await createTrialCheckoutUrl(BUSINESS_ID);

    expect(result.ok).toBe(false);
  });

  it("reports the Android native source so it cannot fall through to the website surface", async () => {
    mocks.platform.os = "android";
    mocks.invoke.mockResolvedValue({ data: { checkout_url: "https://checkout.stripe.com/x" }, error: null });

    const result = await createTrialCheckoutUrl(BUSINESS_ID);

    expect(result.ok).toBe(true);
    expect(mocks.invoke.mock.calls[0][1].body.source).toBe("native_android");
  });

  it("never invokes Checkout on a non-native platform", async () => {
    mocks.platform.os = "web";

    const result = await createTrialCheckoutUrl(BUSINESS_ID);

    expect(result).toMatchObject({ ok: false, code: "NATIVE_TRIAL_CHECKOUT_UNAVAILABLE" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("carries no client-side kill switch — the server capability is the only gate", async () => {
    // Regression guard for the 1.0.2 defect: a binary-baked env flag decided
    // button visibility while the server decided success, so the two could
    // disagree. Neither platform may consult an env flag here again.
    const source = readFileSync(join(process.cwd(), "lib/billing-activation.ts"), "utf8");
    // Asserts on env *reads*, not the words: the header comment names the
    // retired flag on purpose so the history stays discoverable.
    expect(source).not.toContain("process.env");
    expect(source).not.toContain("export function isIosTrialCheckoutEnabled");
  });

  it("fails closed before invoking when the business id is missing", async () => {
    const result = await createTrialCheckoutUrl("");

    expect(result).toMatchObject({ ok: false, code: "BUSINESS_ID_REQUIRED" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("rejects non-HTTPS and non-Stripe Checkout destinations", async () => {
    for (const url of [
      "http://checkout.stripe.com/c/pay/cs_test",
      "https://stripe.example.com/c/pay/cs_test",
      "https://checkout.stripe.com.evil.example/c/pay/cs_test",
      "not a url",
    ]) {
      mocks.invoke.mockResolvedValueOnce({ data: { checkout_url: url }, error: null });
      await expect(createTrialCheckoutUrl(BUSINESS_ID)).resolves.toMatchObject({
        ok: false,
        code: "CHECKOUT_URL_NOT_ALLOWED",
      });
    }
    expect(isAllowedStripeCheckoutUrl("https://checkout.stripe.com/c/pay/cs_test")).toBe(true);
  });
});
