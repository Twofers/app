import { describe, it, expect, vi, afterEach } from "vitest";
import { sendExpoPushMessages, type ExpoPushMessage } from "./expo-push.ts";

const EXPO_URL = "https://exp.host/--/api/v2/push/send";
const msg = (to: string): ExpoPushMessage => ({ to, title: "t", body: "b", sound: "default", channelId: "deal-alerts" });

afterEach(() => vi.unstubAllGlobals());

describe("sendExpoPushMessages — real Expo push path + failure safety", () => {
  it("POSTs to the Expo push API and counts ok tickets", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ status: "ok" }, { status: "ok" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendExpoPushMessages([msg("a"), msg("b")]);

    expect(fetchMock).toHaveBeenCalledWith(EXPO_URL, expect.objectContaining({ method: "POST" }));
    expect(res).toEqual({ sent: 2, errors: 0 });
  });

  it("counts error tickets without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ status: "ok" }, { status: "error", details: { error: "DeviceNotRegistered" } }] }),
      }),
    );
    const res = await sendExpoPushMessages([msg("a"), msg("b")]);
    expect(res).toEqual({ sent: 1, errors: 1 });
  });

  it("does not throw on a network failure; counts the batch as errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const res = await sendExpoPushMessages([msg("a"), msg("b")]);
    expect(res.sent).toBe(0);
    expect(res.errors).toBe(2);
  });

  it("continues to later batches after one fails (>100 messages)", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        call++;
        if (call === 1) throw new Error("boom"); // first 100-message batch fails
        return { ok: true, json: async () => ({ data: Array(50).fill({ status: "ok" }) }) };
      }),
    );
    const res = await sendExpoPushMessages(Array.from({ length: 150 }, (_, i) => msg("u" + i)));
    expect(res.errors).toBe(100); // failed first batch
    expect(res.sent).toBe(50); // second batch still sent
  });

  it("returns zero and never calls fetch for an empty list", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await sendExpoPushMessages([]);
    expect(res).toEqual({ sent: 0, errors: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
