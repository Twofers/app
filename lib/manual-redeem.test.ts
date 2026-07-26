import { beforeEach, describe, expect, it, vi } from "vitest";

const beginVisualRedeem = vi.fn();
const invoke = vi.fn();

vi.mock("@/lib/supabase", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
vi.mock("@/lib/functions", () => ({
  beginVisualRedeem: (...a: unknown[]) => beginVisualRedeem(...a),
  EDGE_FUNCTION_TIMEOUT_MS: 30_000,
  parseFunctionError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const { manualRedeemClaim } = await import("./manual-redeem");

beforeEach(() => {
  beginVisualRedeem.mockReset();
  invoke.mockReset();
});

describe("manualRedeemClaim", () => {
  it("starts the redemption then completes it with the manual flag", async () => {
    beginVisualRedeem.mockResolvedValue({ ok: true });
    invoke.mockResolvedValue({ data: { ok: true, redeemed_at: "2026-07-26T18:00:00Z" }, error: null });

    const out = await manualRedeemClaim("claim-1");

    expect(beginVisualRedeem).toHaveBeenCalledWith("claim-1");
    expect(invoke).toHaveBeenCalledWith(
      "complete-visual-redeem",
      expect.objectContaining({ body: { claim_id: "claim-1", manual: true } }),
    );
    expect(out.ok).toBe(true);
  });

  // A claim can finish between the tap and the call: staff scan it, or the 30s
  // visual-redeem TTL auto-finalizes one left in `redeeming`. The customer got
  // what they asked for, so this must read as success, not "something failed".
  it.each([
    "This claim has already been redeemed",
    "This token has already been redeemed",
  ])("treats begin's %s as success and lets complete answer", async (message) => {
    beginVisualRedeem.mockRejectedValue(new Error(message));
    invoke.mockResolvedValue({
      data: { ok: true, already_redeemed: true, redeemed_at: "2026-07-26T18:00:00Z" },
      error: null,
    });

    const out = await manualRedeemClaim("claim-1");

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(out.already_redeemed).toBe(true);
  });

  it.each([
    "This claim has expired",
    "This claim does not belong to you",
    "This is sample content for testing only. Not a real offer.",
  ])("still surfaces a real begin failure: %s", async (message) => {
    beginVisualRedeem.mockRejectedValue(new Error(message));

    await expect(manualRedeemClaim("claim-1")).rejects.toThrow(message);
    // The redemption must not be attempted once begin genuinely refused.
    expect(invoke).not.toHaveBeenCalled();
  });

  it("surfaces an error body returned by complete-visual-redeem", async () => {
    beginVisualRedeem.mockResolvedValue({ ok: true });
    invoke.mockResolvedValue({ data: { error: "Redemption window has not finished yet" }, error: null });

    await expect(manualRedeemClaim("claim-1")).rejects.toThrow("Redemption window has not finished yet");
  });
});
