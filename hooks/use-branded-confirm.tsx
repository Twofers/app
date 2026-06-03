import { useCallback, useState } from "react";
import type MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { BrandedConfirmModal } from "@/components/ui/branded-confirm-modal";

export type BrandedConfirmOptions = {
  title: string;
  message: string;
  /** Primary CTA — always rendered as the orange brand button. */
  confirmLabel: string;
  onConfirm?: () => void;
  /** Secondary CTA — neutral outline button. Omit for a single-action info dialog. */
  cancelLabel?: string;
  onCancel?: () => void;
  /** Optional brand icon shown in an orange badge above the title. */
  iconName?: keyof typeof MaterialIcons.glyphMap;
};

/**
 * Imperative, TWOFER-branded replacement for `Alert.alert`. Call `confirm(options)`
 * to open the branded modal (orange `PrimaryButton` + neutral `SecondaryButton`), and
 * render the returned `confirmModal` element once near the root of the screen.
 *
 * The modal stays mounted so the fade animation runs; only one dialog shows at a time,
 * matching `Alert`'s semantics. Drop-in mapping from a two-button `Alert.alert`:
 *
 *   Alert.alert(title, body, [
 *     { text: cancel, style: "cancel" },
 *     { text: cta, style: "destructive", onPress: doX },
 *   ])
 *   →
 *   confirm({ title, message: body, confirmLabel: cta, onConfirm: doX, cancelLabel: cancel })
 */
export function useBrandedConfirm() {
  const [options, setOptions] = useState<BrandedConfirmOptions | null>(null);
  const [visible, setVisible] = useState(false);

  const confirm = useCallback((next: BrandedConfirmOptions) => {
    setOptions(next);
    setVisible(true);
  }, []);

  const close = useCallback(() => setVisible(false), []);

  const confirmModal = (
    <BrandedConfirmModal
      visible={visible}
      title={options?.title ?? ""}
      message={options?.message ?? ""}
      confirmLabel={options?.confirmLabel ?? ""}
      cancelLabel={options?.cancelLabel}
      iconName={options?.iconName}
      onConfirm={() => {
        close();
        options?.onConfirm?.();
      }}
      // Only wire a cancel handler when the dialog has a secondary action; otherwise the
      // modal treats a backdrop tap as a dismiss via onConfirm (single-action info dialog).
      onCancel={
        options?.cancelLabel
          ? () => {
              close();
              options?.onCancel?.();
            }
          : undefined
      }
    />
  );

  return { confirm, confirmModal };
}
