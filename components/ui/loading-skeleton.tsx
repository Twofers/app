import { useWindowDimensions, View } from "react-native";
import { Spacing } from "@/lib/screen-layout";

type LoadingSkeletonProps = {
  rows?: number;
};

export function LoadingSkeleton({ rows = 3 }: LoadingSkeletonProps) {
  const { height } = useWindowDimensions();
  const rowHeight = Math.round(Math.min(420, Math.max(300, height * 0.52)));

  return (
    <View style={{ gap: Spacing.lg }}>
      {Array.from({ length: rows }).map((_, idx) => (
        <View
          key={`skeleton-${idx}`}
          style={{
            borderRadius: 20,
            backgroundColor: "#ebebeb",
            height: rowHeight,
          }}
        />
      ))}
    </View>
  );
}
