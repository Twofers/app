import type { ComponentProps } from "react";
import { View } from "react-native";

export type AppleWalletPassButtonProps = ComponentProps<typeof View> & {
  disabled?: boolean;
  onPress?: () => void;
};

export function AppleWalletPassButton(_props: AppleWalletPassButtonProps) {
  return null;
}

export async function presentAppleWalletPass(_base64: string): Promise<void> {
  throw new Error("Apple Wallet is available only on iOS.");
}
