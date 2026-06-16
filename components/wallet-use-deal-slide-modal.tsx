import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { SlideToUseDeal } from "@/components/slide-to-use-deal";
import { Colors, Radii } from "@/constants/theme";
import { Spacing } from "@/lib/screen-layout";
import { HapticScalePressable } from "@/components/ui/haptic-scale-pressable";
import { useColorScheme } from "@/hooks/use-color-scheme";

type WalletUseDealSlideModalProps = {
  visible: boolean;
  dealTitle: string;
  businessName: string;
  busy: boolean;
  onConfirmSlide: () => void;
  onClose: () => void;
};

export function WalletUseDealSlideModal({
  visible,
  dealTitle,
  businessName,
  busy,
  onConfirmSlide,
  onClose,
}: WalletUseDealSlideModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];

  return (
    <Modal visible={visible} animationType="fade" transparent accessibilityViewIsModal>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.72)",
          justifyContent: "flex-end",
        }}
      >
        <Pressable style={{ flex: 1 }} onPress={busy ? undefined : onClose} />
        <View
          style={{
            backgroundColor: theme.surface,
            borderTopLeftRadius: Radii.lg,
            borderTopRightRadius: Radii.lg,
            borderWidth: 1,
            borderBottomWidth: 0,
            borderColor: theme.border,
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: Math.max(insets.bottom + 16, 24),
          }}
        >
          <Text style={{ fontSize: 22, fontWeight: "900", letterSpacing: -0.3, color: theme.text }} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.82} maxFontSizeMultiplier={1.15}>
            {t("consumerWallet.useDealTitle")}
          </Text>
          <Text style={{ marginTop: Spacing.sm, fontSize: 15, color: theme.mutedText }} numberOfLines={1} maxFontSizeMultiplier={1.15}>
            {businessName}
          </Text>
          <Text style={{ marginTop: 4, fontSize: 16, fontWeight: "700", color: theme.text }} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.82} maxFontSizeMultiplier={1.15}>
            {dealTitle}
          </Text>
          <Text style={{ marginTop: Spacing.md, fontSize: 14, color: theme.mutedText, lineHeight: 20 }} maxFontSizeMultiplier={1.15}>
            {t("consumerWallet.useDealBody")}
          </Text>
          <View style={{ marginTop: Spacing.lg }}>
            <SlideToUseDeal onConfirmed={onConfirmSlide} disabled={busy} />
          </View>
          <HapticScalePressable
            onPress={onClose}
            disabled={busy}
            style={{ marginTop: Spacing.lg, paddingVertical: Spacing.md, opacity: busy ? 0.5 : 1 }}
          >
            <Text style={{ textAlign: "center", fontWeight: "700", color: theme.mutedText }} numberOfLines={1} maxFontSizeMultiplier={1.15}>
              {t("commonUi.cancel")}
            </Text>
          </HapticScalePressable>
        </View>
      </View>
    </Modal>
  );
}
