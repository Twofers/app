import { Pressable, Text, ViewStyle } from "react-native";

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
          paddingVertical: 14,
          paddingHorizontal: 16,
          borderRadius: 12,
          backgroundColor: "#111",
          opacity: disabled ? 0.7 : 1,
        },
        style,
      ]}
    >
      <Text style={{ color: "white", fontWeight: "700", textAlign: "center" }}>{title}</Text>
    </Pressable>
  );
}
