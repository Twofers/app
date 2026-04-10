import { useWindowDimensions, View, type DimensionValue } from "react-native";
import { Spacing } from "@/lib/screen-layout";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

type LoadingSkeletonProps = {
  rows?: number;
};

export function LoadingSkeleton({ rows = 3 }: LoadingSkeletonProps) {
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const { height: windowHeight } = useWindowDimensions();
  const imageHeight = Math.round(Math.max(280, windowHeight * 0.48));
  const cardHeight = Math.round(Math.min(860, Math.max(640, imageHeight + 320)));

  const block = (height: number, width: DimensionValue, radius = 12) => (
    <View style={{ height, width, borderRadius: radius, backgroundColor: theme.border }} />
  );

  return (
    <View style={{ gap: Spacing.lg }}>
      {Array.from({ length: rows }).map((_, idx) => (
        <View
          key={`skeleton-${idx}`}
          style={{
            borderRadius: 24,
            backgroundColor: theme.surface,
            overflow: "hidden",
            height: cardHeight,
            borderWidth: 1,
            borderColor: theme.border,
          }}
        >
          {/* Poster */}
          <View style={{ height: imageHeight, width: "100%", backgroundColor: theme.surfaceMuted }} />

          {/* Content */}
          <View style={{ padding: Spacing.xxl, gap: Spacing.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.sm }}>
              {block(22, 84, 999)}
              {block(22, 110, 999)}
            </View>

            <View style={{ gap: 6 }}>
              {block(12, 130, 8)}
              {block(10, 88, 8)}
            </View>

            <View style={{ gap: 10 }}>
              {block(22, "92%", 10)}
              {block(18, "72%", 10)}
            </View>

            {block(14, 220, 8)}
            {block(14, 180, 8)}
          </View>

          {/* Bottom action area */}
          <View
            style={{
              marginTop: "auto",
              paddingHorizontal: Spacing.xxl,
              paddingVertical: Spacing.xxl,
              gap: Spacing.lg,
              borderTopWidth: 1,
              borderTopColor: theme.border,
              backgroundColor: theme.surface,
            }}
          >
            {block(56, "100%", 24)}
            {block(64, "100%", 24)}
          </View>
        </View>
      ))}
    </View>
  );
}
