import { Modal, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { DealCardPoster } from "@/components/deal-card-poster";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { Colors, Radii } from "@/constants/theme";
import { Spacing } from "@/lib/screen-layout";
import { useColorScheme } from "@/hooks/use-color-scheme";

type DealPreviewModalProps = {
  visible: boolean;
  onDismiss: () => void;
  onPublish: () => void;
  publishing: boolean;
  title: string;
  description: string;
  businessName: string | null;
  posterUrl: string | null;
  price: number | null;
  endTime: string;
  remainingClaims: number | null;
};

const noop = () => {};

export function DealPreviewModal({
  visible,
  onDismiss,
  onPublish,
  publishing,
  title,
  description,
  businessName,
  posterUrl,
  price,
  endTime,
  remainingClaims,
}: DealPreviewModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      accessibilityViewIsModal={true}
      onRequestClose={onDismiss}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.5)",
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: theme.background,
            borderTopLeftRadius: Radii.lg,
            borderTopRightRadius: Radii.lg,
            marginTop: Spacing.lg,
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: Spacing.md,
              paddingVertical: Spacing.md,
              borderBottomWidth: 1,
              borderBottomColor: theme.border,
            }}
          >
            <Text
              style={{ flex: 1, minWidth: 0, fontWeight: "800", fontSize: 17, color: theme.text }}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
              maxFontSizeMultiplier={1.15}
            >
              {t("createQuick.previewTitle", { defaultValue: "Deal preview" })}
            </Text>
            <Text
              onPress={onDismiss}
              style={{ flexShrink: 0, fontSize: 15, fontWeight: "700", color: theme.mutedText }}
              numberOfLines={1}
              maxFontSizeMultiplier={1.15}
            >
              {t("createQuick.previewGoBack", { defaultValue: "Back" })}
            </Text>
          </View>

          {/* Card preview */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: Spacing.md, paddingBottom: Spacing.xl }}
            showsVerticalScrollIndicator={false}
          >
            <Text
              style={{
                fontSize: 13,
                color: theme.mutedText,
                marginBottom: Spacing.sm,
                textAlign: "center",
              }}
              maxFontSizeMultiplier={1.15}
            >
              {t("createQuick.previewHint", { defaultValue: "Review what customers will see before publishing." })}
            </Text>
            <DealCardPoster
              title={title || t("createQuick.placeholderTitle", { defaultValue: "Deal title" })}
              description={description || null}
              businessName={businessName}
              distanceLabel={null}
              posterUrl={posterUrl}
              price={price}
              endTime={endTime}
              remainingClaims={remainingClaims}
              isFavorite={false}
              onPress={noop}
              onToggleFavorite={noop}
              onClaim={noop}
              claiming={false}
              dealStatus="live"
              showLiveCountdown
            />
          </ScrollView>

          {/* Action buttons */}
          <View
            style={{
              paddingHorizontal: Spacing.md,
              paddingTop: Spacing.sm,
              paddingBottom: Math.max(insets.bottom, Spacing.md),
              gap: Spacing.sm,
              borderTopWidth: 1,
              borderTopColor: theme.border,
            }}
          >
            <PrimaryButton
              title={
                publishing
                  ? t("createQuick.publishing", { defaultValue: "Publishing..." })
                  : t("createQuick.previewPublish", { defaultValue: "Publish deal" })
              }
              onPress={onPublish}
              disabled={publishing}
            />
            <SecondaryButton title={t("createQuick.previewGoBack", { defaultValue: "Back" })} onPress={onDismiss} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
