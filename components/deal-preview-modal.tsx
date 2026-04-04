import { Modal, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { DealCardPoster } from "@/components/deal-card-poster";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { Colors, Radii } from "@/constants/theme";
import { Spacing } from "@/lib/screen-layout";

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

  return (
    <Modal visible={visible} transparent animationType="slide">
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
            backgroundColor: Colors.light.background,
            borderTopLeftRadius: Radii.xl,
            borderTopRightRadius: Radii.xl,
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
              borderBottomColor: Colors.light.border,
            }}
          >
            <Text style={{ fontWeight: "800", fontSize: 17, color: Colors.light.text }}>
              {t("createQuick.previewTitle")}
            </Text>
            <Text
              onPress={onDismiss}
              style={{ fontSize: 15, fontWeight: "700", color: Colors.light.mutedText }}
            >
              {t("createQuick.previewGoBack")}
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
                color: Colors.light.mutedText,
                marginBottom: Spacing.sm,
                textAlign: "center",
              }}
            >
              {t("createQuick.previewHint")}
            </Text>
            <DealCardPoster
              title={title || t("createQuick.placeholderTitle")}
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
              borderTopColor: Colors.light.border,
            }}
          >
            <PrimaryButton
              title={publishing ? t("createQuick.publishing") : t("createQuick.previewPublish")}
              onPress={onPublish}
              disabled={publishing}
              style={{ height: 56, borderRadius: 18 }}
            />
            <SecondaryButton title={t("createQuick.previewGoBack")} onPress={onDismiss} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
