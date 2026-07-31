import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("./supabase", () => ({
  supabase: {
    functions: { invoke: mocks.invoke },
  },
}));

// billing-activation pulls in ./functions, which reaches react-native/expo.
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
}));

vi.mock("expo-constants", () => ({
  default: {
    executionEnvironment: "standalone",
    expoConfig: { version: "1.0.0" },
  },
}));

import { createTrialCheckoutUrl } from "./billing-activation";

const BUSINESS_ID = "1f0b2b7e-7f4a-4a1e-9c3e-2f5d6a7b8c90";

describe("createTrialCheckoutUrl", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
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
    expect(options.body).toEqual({ business_id: BUSINESS_ID, locale: "ko" });
    // The server resolves price, source, and trial length; the client must not
    // be able to influence any of them.
    expect(options.body).not.toHaveProperty("price_id");
    expect(options.body).not.toHaveProperty("source");
    expect(options.body).not.toHaveProperty("billing_token");
  });

  it("omits locale when the caller has none", async () => {
    mocks.invoke.mockResolvedValue({ data: { checkout_url: "https://checkout.stripe.com/x" }, error: null });

    await createTrialCheckoutUrl(BUSINESS_ID);

    expect(mocks.invoke.mock.calls[0][1].body).toEqual({ business_id: BUSINESS_ID });
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
});
