import { Pressable, Text, ViewStyle } from "react-native";

import { Fonts } from "@/constants/theme";

type PrimaryButtonProps = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
};

export function PrimaryButton({ title, onPress, disabled, style }: PrimaryButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        {
          minHeight: 48,
          paddingVertical: 14,
          paddingHorizontal: 16,
          borderRadius: 12,
          backgroundColor: "#111",
          opacity: disabled ? 0.7 : 1,
          justifyContent: "center",
        },
        style,
      ]}
    >
      <Text
        style={{
          color: "white",
          fontWeight: "700",
          textAlign: "center",
          ...(Fonts.sans ? { fontFamily: Fonts.sans } : {}),
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}
