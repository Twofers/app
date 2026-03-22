import { Text, View } from "react-native";

type EmptyStateProps = {
  title: string;
  message: string;
};

export function EmptyState({ title, message }: EmptyStateProps) {
  return (
    <View style={{ alignItems: "center", paddingVertical: 32 }}>
      <Text style={{ fontSize: 16, fontWeight: "700", marginBottom: 6 }}>{title}</Text>
      <Text style={{ opacity: 0.7, textAlign: "center" }}>{message}</Text>
    </View>
  );
}
