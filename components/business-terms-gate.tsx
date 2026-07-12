import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { MaterialIcons } from "@expo/vector-icons";

import { CardShell } from "@/components/ui/card-shell";
import { PrimaryButton } from "@/components/ui/primary-button";
import { Banner } from "@/components/ui/banner";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { Colors, Spacing } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { TERMS_OF_SERVICE_URL, openWebsiteUrl } from "@/lib/legal-urls";
import { acceptBusinessTerms } from "@/lib/business-terms";
import { translateKnownApiMessage } from "@/lib/i18n/api-messages";

type Props = {
  businessId: string;
  /** Called once terms are accepted and can_business_publish() no longer returns terms_required. */
  onAccepted: () => void;
};

export function BusinessTermsGate({ businessId, onAccepted }: Props) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    if (!checked || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await acceptBusinessTerms(businessId);
      const stillRequired = result.publish?.reason_code === "terms_required" || result.publish?.reason === "terms_required";
      if (stillRequired) {
        setError(t("businessTerms.acceptFailed", { defaultValue: "Couldn't confirm terms acceptance. Please try again." }));
        return;
      }
      onAccepted();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setError(translateKnownApiMessage(message, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <CardShell variant="muted">
      <View style={{ gap: Spacing.sm }}>
        <Text style={{ fontSize: 17, fontWeight: "900", color: theme.text }}>
          {t("businessTerms.gateTitle", { defaultValue: "Accept the business terms to publish" })}
        </Text>
        <Text style={{ fontSize: 14, lineHeight: 20, fontWeight: "600", color: theme.mutedText }}>
          {t("businessTerms.gateBody", {
            defaultValue: "Before you can publish offers, you need to review and accept the Twofer Business Terms.",
          })}
        </Text>

        <Pressable
          onPress={() => void openWebsiteUrl(TERMS_OF_SERVICE_URL)}
          accessibilityRole="link"
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          style={{ minHeight: 44, justifyContent: "center", marginTop: Spacing.xs }}
        >
          <Text style={{ fontSize: 14, fontWeight: "700", color: theme.accentText, textDecorationLine: "underline" }}>
            {t("businessTerms.viewFullTerms", { defaultValue: "Read the Twofer Business Terms" })}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setChecked((value) => !value)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 8,
            padding: 10,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: checked ? theme.primary : theme.border,
            backgroundColor: colorScheme === "dark" ? theme.surface : "#fff",
            marginTop: Spacing.xs,
          }}
        >
          <MaterialIcons
            name={checked ? "check-box" : "check-box-outline-blank"}
            size={22}
            color={checked ? theme.primary : theme.mutedText}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: theme.text, lineHeight: 18 }}>
              {t("businessTerms.checkboxLabel", { defaultValue: "I have read and accept the Twofer Business Terms." })}
            </Text>
          </View>
        </Pressable>

        {error ? <Banner message={error} tone="error" /> : null}

        <View style={{ marginTop: Spacing.xs }}>
          <PrimaryButton
            title={busy ? t("businessTerms.accepting", { defaultValue: "Saving..." }) : t("businessTerms.acceptCta", { defaultValue: "Accept and continue" })}
            onPress={() => void handleAccept()}
            disabled={!checked || busy}
          />
        </View>
      </View>
    </CardShell>
  );
}
