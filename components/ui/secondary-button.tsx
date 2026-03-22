import { Pressable, Text, ViewStyle } from "react-native";

type SecondaryButtonProps = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
};

export function SecondaryButton({ title, onPress, disabled, style }: SecondaryButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        {
          paddingVertical: 14,
          paddingHorizontal: 16,
          borderRadius: 12,
          backgroundColor: "#eee",
          opacity: disabled ? 0.7 : 1,
        },
        style,
      ]}
    >
      <Text style={{ color: "#111", fontWeight: "700", textAlign: "center" }}>{title}</Text>
    </Pressable>
  );
}
