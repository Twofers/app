import { Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Colors, Radii } from "@/constants/theme";
import { Spacing } from "@/lib/screen-layout";
import {
  DEMO_OFFER_DETAIL_EXPLANATION,
  DEMO_OFFER_LABEL,
  DEMO_OFFER_SHORT_EXPLANATION,
} from "@/lib/demo-content";

type DemoOfferNoticeProps = {
  compact?: boolean;
  detail?: boolean;
};

export function DemoOfferNotice({ compact = false, detail = false }: DemoOfferNoticeProps) {
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const body = detail ? DEMO_OFFER_DETAIL_EXPLANATION : DEMO_OFFER_SHORT_EXPLANATION;

  return (
    <View
      style={{
        borderRadius: compact ? Radii.md : Radii.lg,
        borderWidth: 1,
        borderColor: colorScheme === "dark" ? "rgba(255,159,28,0.42)" : "#FDBA74",
        backgroundColor: colorScheme === "dark" ? "rgba(255,159,28,0.14)" : "#FFF7ED",
        paddingVertical: compact ? Spacing.sm : Spacing.md,
        paddingHorizontal: compact ? Spacing.md : Spacing.lg,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: Spacing.sm,
      }}
    >
      <MaterialIcons name="info-outline" size={18} color={theme.accentText} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: theme.accentText, fontWeight: "900", fontSize: compact ? 12 : 14 }} maxFontSizeMultiplier={1.15}>
          {DEMO_OFFER_LABEL}
        </Text>
        {!compact ? (
          <Text style={{ marginTop: 3, color: colorScheme === "dark" ? theme.text : "#7C2D12", fontSize: 13, lineHeight: 18 }} maxFontSizeMultiplier={1.15}>
            {body}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
