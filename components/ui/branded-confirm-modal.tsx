import { Modal, Pressable, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { Colors, Radii, Shadows } from "@/constants/theme";
import { Spacing } from "@/lib/screen-layout";
import { useColorScheme } from "@/hooks/use-color-scheme";

type BrandedConfirmModalProps = {
  visible: boolean;
  title: string;
  message: string;
  /** Primary CTA — always rendered as the orange brand button. */
  confirmLabel: string;
  onConfirm: () => void;
  /** Secondary CTA — neutral outline button. Omit for a single-action info dialog. */
  cancelLabel?: string;
  onCancel?: () => void;
  /** Optional brand icon shown in an orange badge above the title. */
  iconName?: keyof typeof MaterialIcons.glyphMap;
};

/**
 * TWOFER-branded replacement for `Alert.alert`. Keeps the primary action in brand
 * orange (`PrimaryButton`) and the secondary action neutral (`SecondaryButton`) so
 * confirm dialogs never fall back to the platform's teal OS buttons.
 *
 * Tapping the dimmed backdrop is treated as a cancel (or as dismiss for an
 * info-only dialog), matching `Alert`'s outside-tap behavior.
 */
export function BrandedConfirmModal({
  visible,
  title,
  message,
  confirmLabel,
  onConfirm,
  cancelLabel,
  onCancel,
  iconName,
}: BrandedConfirmModalProps) {
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const dismiss = onCancel ?? onConfirm;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismiss}
      accessibilityViewIsModal
    >
      <Pressable
        onPress={dismiss}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.5)",
          justifyContent: "center",
          paddingHorizontal: Spacing.xl,
        }}
      >
        {/* Claim the touch so taps inside the card don't dismiss via the backdrop. */}
        <View
          onStartShouldSetResponder={() => true}
          style={{
            backgroundColor: theme.surface,
            borderRadius: Radii.lg,
            padding: Spacing.xl,
            gap: Spacing.sm,
            ...Shadows.soft,
          }}
        >
          {iconName ? (
            <View
              style={{
                alignSelf: "center",
                width: 56,
                height: 56,
                borderRadius: 28,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: Spacing.xs,
                backgroundColor: colorScheme === "dark" ? "rgba(255,159,28,0.22)" : "rgba(255,159,28,0.14)",
              }}
            >
              <MaterialIcons name={iconName} size={28} color={theme.primary} />
            </View>
          ) : null}
          <Text style={{ fontSize: 20, fontWeight: "900", color: theme.text, textAlign: "center" }}>{title}</Text>
          <Text style={{ fontSize: 15, lineHeight: 22, color: theme.mutedText, textAlign: "center" }}>{message}</Text>
          <View style={{ marginTop: Spacing.md, gap: Spacing.sm }}>
            <PrimaryButton title={confirmLabel} onPress={onConfirm} />
            {cancelLabel ? <SecondaryButton title={cancelLabel} onPress={dismiss} /> : null}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}
