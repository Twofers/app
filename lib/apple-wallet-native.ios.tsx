import type { ComponentProps } from "react";
import {
  canAddPassesAsync,
  presentPassAsync,
  TwoferPassKitButton,
} from "@/modules/twofer-passkit/src";

export type AppleWalletPassButtonProps = ComponentProps<typeof TwoferPassKitButton>;
export const AppleWalletPassButton = TwoferPassKitButton;

export async function presentAppleWalletPass(base64: string): Promise<void> {
  if (!(await canAddPassesAsync())) {
    throw new Error("This device cannot add Apple Wallet passes.");
  }

  const result = await presentPassAsync(base64);
  if (result !== "presented") {
    throw new Error(`Apple Wallet could not present this pass (${result}).`);
  }
}
