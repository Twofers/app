import { describe, expect, it, vi } from "vitest";
import type { TFunction } from "i18next";

vi.mock("react-native", () => ({
  Share: {
    dismissedAction: "dismissedAction",
    share: vi.fn(),
  },
}));

vi.mock("expo-crypto", () => ({
  getRandomBytes: (length: number) => new Uint8Array(length).fill(2),
}));

vi.mock("./supabase", () => ({
  supabase: {},
}));

vi.mock("./runtime-env", () => ({
  isShareDealEnabled: () => true,
}));

import { buildShareCopy } from "./share-deal";

const t: TFunction = ((key: string, options?: { defaultValue?: string; [key: string]: unknown }) => {
  const template = options?.defaultValue ?? key;
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ""));
}) as TFunction;

describe("buildShareCopy", () => {
  it("shares the deal title and link only", () => {
    const copy = buildShareCopy({
      shareCode: "ABCD234",
      dealTitle: "Buy one iced Americano, get one free",
      businessName: "Cedar & Bean Cafe",
      t,
    });

    expect(copy.message).toBe("Buy one iced Americano, get one free\nhttps://www.twoferapp.com/s/ABCD234");
    expect(copy.message).not.toContain("Twofer");
    expect(copy.message).not.toContain("BOGO");
    expect(copy.message).not.toContain("Cedar & Bean Cafe");
  });
});
