import { Fragment } from "react";
import { Linking, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import {
  DELETE_ACCOUNT_URL,
  PRIVACY_POLICY_URL,
  SUPPORT_URL,
  TERMS_OF_SERVICE_URL,
} from "@/lib/legal-urls";

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
            <Text style={{ fontSize: 14, opacity: 0.35 }} aria-hidden>
              ·
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="link"
            onPress={() => void open(item.url)}
            style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
          >
            <Text style={{ fontSize: 14, fontWeight: "600", color: "#2563eb" }}>{item.label}</Text>
          </Pressable>
        </Fragment>
      ))}
    </View>
  );
}
