import { describe, expect, it } from "vitest";
import { getDeleteAccountConfirmationCopyKeys } from "./delete-account-confirmation";

describe("delete account confirmation copy keys", () => {
  it("uses business impact copy when deletion may include business data", () => {
    expect(getDeleteAccountConfirmationCopyKeys(true)).toEqual({
      impactBodyKey: "deleteAccount.body",
      finalBodyKey: "deleteAccount.finalBusinessBody",
    });
  });

  it("uses consumer impact copy when deletion only affects the shopper account", () => {
    expect(getDeleteAccountConfirmationCopyKeys(false)).toEqual({
      impactBodyKey: "deleteAccount.bodyConsumer",
      finalBodyKey: "deleteAccount.finalConsumerBody",
    });
  });
});
