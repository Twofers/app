import { View } from "react-native";

type LoadingSkeletonProps = {
  rows?: number;
};

export function LoadingSkeleton({ rows = 3 }: LoadingSkeletonProps) {
  return (
    <View style={{ gap: 12 }}>
      {Array.from({ length: rows }).map((_, idx) => (
        <View
          key={`skeleton-${idx}`}
          style={{
            borderRadius: 18,
            backgroundColor: "#f1f1f1",
            height: 240,
          }}
        />
      ))}
    </View>
  );
}
