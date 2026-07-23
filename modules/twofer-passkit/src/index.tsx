import { requireNativeModule, requireNativeViewManager } from "expo-modules-core";
import type { ComponentType } from "react";
import type { NativeSyntheticEvent, StyleProp, ViewStyle } from "react-native";

export type PresentPassResult = "presented" | "unsupported" | "invalid_pass" | "no_presenter";

type TwoferPassKitNativeModule = {
  canAddPassesAsync(): Promise<boolean>;
  presentPassAsync(base64: string): Promise<PresentPassResult>;
};

export type TwoferPassKitButtonProps = {
  disabled?: boolean;
  onPress?: (event: NativeSyntheticEvent<Record<string, never>>) => void;
  style?: StyleProp<ViewStyle>;
};

const nativeModule = requireNativeModule<TwoferPassKitNativeModule>("TwoferPassKit");

export const TwoferPassKitButton = requireNativeViewManager<TwoferPassKitButtonProps>(
  "TwoferPassKit",
) as ComponentType<TwoferPassKitButtonProps>;

export const canAddPassesAsync = () => nativeModule.canAddPassesAsync();
export const presentPassAsync = (base64: string) => nativeModule.presentPassAsync(base64);
