import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { Banner } from "@/components/ui/banner";
import { Colors, Radii } from "@/constants/theme";
import { Spacing } from "@/lib/screen-layout";
import {
  BUSINESS_REPORT_REASONS,
  USER_REPORT_REASONS,
  type BusinessReportReason,
  type UserReportReason,
} from "@/lib/reports";

type ReportMode = "business" | "user";

type Props = {
  visible: boolean;
  mode: ReportMode;
  subjectLabel: string;
  onDismiss: () => void;
  onSubmit: (input: { reason: string; comment: string }) => Promise<{ ok: boolean; errorMessage?: string }>;
};

export function ReportSheet({ visible, mode, subjectLabel, onDismiss, onSubmit }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const reasons: readonly (BusinessReportReason | UserReportReason)[] =
    mode === "business" ? BUSINESS_REPORT_REASONS : USER_REPORT_REASONS;
  const [reason, setReason] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!visible) {
      setReason(null);
      setComment("");
      setError(null);
      setSubmitted(false);
      setSubmitting(false);
    }
  }, [visible]);

  async function handleSubmit() {
    if (!reason) {
      setError(t("report.errPickReason", { defaultValue: "Please choose a reason." }));
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await onSubmit({ reason, comment: comment.trim() });
    setSubmitting(false);
    if (result.ok) {
      setSubmitted(true);
      return;
    }
    setError(result.errorMessage ?? t("report.errFailed", { defaultValue: "We couldn't submit your report. Try again." }));
  }

  const reasonLabel = (key: string) =>
    t(`report.${mode}Reason.${key}`, {
      defaultValue: defaultReasonLabel(mode, key),
    });

  const sheetTitle =
    mode === "business"
      ? t("report.businessTitle", { defaultValue: "Report this business" })
      : t("report.userTitle", { defaultValue: "Report this customer" });

  const sheetSubtitle =
    mode === "business"
      ? t("report.businessSubtitle", {
          defaultValue: "Tell us what went wrong. We'll review reports and follow up with the business.",
        })
      : t("report.userSubtitle", {
          defaultValue: "Tell us what happened. We'll review reports and follow up with the customer.",
        });

  return (
    <Modal visible={visible} transparent animationType="slide" accessibilityViewIsModal={true} onRequestClose={onDismiss}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.5)",
          paddingTop: insets.top + Spacing.xl,
          paddingBottom: insets.bottom,
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: Colors.light.background,
            borderTopLeftRadius: Radii.xl,
            borderTopRightRadius: Radii.xl,
            overflow: "hidden",
          }}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl }}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={{ fontSize: 22, fontWeight: "800", color: Colors.light.text }}>{sheetTitle}</Text>
            <Text style={{ fontSize: 13, fontWeight: "700", opacity: 0.65, color: Colors.light.text }}>
              {subjectLabel}
            </Text>
            <Text style={{ fontSize: 14, lineHeight: 20, opacity: 0.78, color: Colors.light.text }}>
              {sheetSubtitle}
            </Text>

            {submitted ? (
              <View style={{ gap: Spacing.md }}>
                <Banner
                  message={t("report.submittedBody", {
                    defaultValue: "Thanks. Your report was submitted to TWOFER.",
                  })}
                  tone="success"
                />
                <PrimaryButton
                  title={t("report.close", { defaultValue: "Close" })}
                  onPress={onDismiss}
                />
              </View>
            ) : (
              <>
                {error ? <Banner message={error} tone="error" /> : null}

                <Text style={{ fontWeight: "700", marginTop: Spacing.sm, color: Colors.light.text }}>
                  {t("report.reasonLabel", { defaultValue: "Reason" })}
                </Text>
                <View style={{ gap: Spacing.sm }}>
                  {reasons.map((r) => {
                    const selected = reason === r;
                    return (
                      <Pressable
                        key={r}
                        onPress={() => setReason(r)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        style={{
                          paddingVertical: Spacing.md,
                          paddingHorizontal: Spacing.lg,
                          borderRadius: Radii.md,
                          borderWidth: selected ? 2 : 1,
                          borderColor: selected ? Colors.light.primary : Colors.light.border,
                          backgroundColor: selected ? "rgba(255,159,28,0.1)" : Colors.light.surface,
                        }}
                      >
                        <Text
                          style={{
                            fontWeight: selected ? "800" : "600",
                            color: Colors.light.text,
                            fontSize: 15,
                          }}
                        >
                          {reasonLabel(r)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={{ fontWeight: "700", marginTop: Spacing.md, color: Colors.light.text }}>
                  {t("report.commentLabel", { defaultValue: "Add details (optional)" })}
                </Text>
                <TextInput
                  value={comment}
                  onChangeText={setComment}
                  multiline
                  placeholder={t("report.commentPlaceholder", {
                    defaultValue: "Anything else we should know?",
                  })}
                  placeholderTextColor={Colors.light.mutedText}
                  maxLength={500}
                  style={{
                    borderWidth: 1,
                    borderColor: Colors.light.border,
                    borderRadius: Radii.md,
                    backgroundColor: Colors.light.surface,
                    padding: Spacing.md,
                    minHeight: 96,
                    fontSize: 15,
                    textAlignVertical: "top",
                    color: Colors.light.text,
                  }}
                />

                <View style={{ marginTop: Spacing.lg, gap: Spacing.sm }}>
                  <PrimaryButton
                    title={
                      submitting
                        ? t("report.submitting", { defaultValue: "Submitting…" })
                        : t("report.submit", { defaultValue: "Submit report" })
                    }
                    onPress={() => void handleSubmit()}
                    disabled={submitting || !reason}
                  />
                  <SecondaryButton
                    title={t("report.cancel", { defaultValue: "Cancel" })}
                    onPress={onDismiss}
                    disabled={submitting}
                  />
                  {submitting ? (
                    <View style={{ alignItems: "center", marginTop: Spacing.xs }}>
                      <ActivityIndicator color={Colors.light.primary} />
                    </View>
                  ) : null}
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function defaultReasonLabel(mode: ReportMode, key: string): string {
  if (mode === "business") {
    switch (key) {
      case "not_honored":
        return "Didn't honor the offer";
      case "doesnt_exist":
        return "Business doesn't exist";
      case "wrong_info":
        return "Wrong info (address, hours, etc.)";
      case "inappropriate":
        return "Inappropriate content";
      case "other":
        return "Something else";
    }
  } else {
    switch (key) {
      case "abusive":
        return "Abusive behavior";
      case "fraud":
        return "Suspected fraud";
      case "no_show":
        return "No-show or wasted offer";
      case "inappropriate":
        return "Inappropriate behavior";
      case "other":
        return "Something else";
    }
  }
  return key;
}
