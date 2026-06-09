import { Fragment } from "react";
import { Linking, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  DELETE_ACCOUNT_URL,
  PRIVACY_POLICY_URL,
  SUPPORT_URL,
  TERMS_OF_SERVICE_URL,
} from "@/lib/legal-urls";
import { HapticScalePressable } from "@/components/ui/haptic-scale-pressable";

type Props = {
  style?: StyleProp<ViewStyle>;
  align?: "start" | "center";
  /** Default true — hide on surfaces where only legal text is needed */
  showSupport?: boolean;
  /** Default false — use near delete-account flows; avoid on sign-up */
  showDeleteAccount?: boolean;
};

export function LegalExternalLinks({
  style,
  align = "start",
  showSupport = true,
  showDeleteAccount = false,
}: Props) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const C = Colors[colorScheme];

  const entries: { url: string; label: string }[] = [
    { url: PRIVACY_POLICY_URL, label: t("legal.privacyPolicy") },
    { url: TERMS_OF_SERVICE_URL, label: t("legal.termsOfService") },
  ];
  if (showSupport) {
    entries.push({ url: SUPPORT_URL, label: t("legal.support") });
  }
  if (showDeleteAccount) {
    entries.push({ url: DELETE_ACCOUNT_URL, label: t("legal.deleteAccount") });
  }

  async function open(url: string) {
    const supported = await Linking.canOpenURL(url);
    if (supported) await Linking.openURL(url);
  }

  return (
    <View
      style={[
        {
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: align === "center" ? "center" : "flex-start",
          gap: 8,
        },
        style,
      ]}
    >
      {entries.map((item, i) => (
        <Fragment key={item.url}>
          {i > 0 ? (
            <Text style={{ fontSize: 14, color: C.mutedText, opacity: 0.45 }} aria-hidden>
              ·
            </Text>
          ) : null}
          <HapticScalePressable
            accessibilityRole="link"
            onPress={() => void open(item.url)}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            style={({ pressed }) => ({
              minHeight: 44,
              paddingHorizontal: 8,
              paddingVertical: 10,
              justifyContent: "center",
              maxWidth: "100%",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text
              style={{ fontSize: 14, fontWeight: "700", color: C.accentText }}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
              maxFontSizeMultiplier={1.15}
            >
              {item.label}
            </Text>
          </HapticScalePressable>
        </Fragment>
      ))}
    </View>
  );
}
