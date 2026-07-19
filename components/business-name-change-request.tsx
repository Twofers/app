import { useCallback, useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { SecondaryButton } from "@/components/ui/secondary-button";
import { Colors, Radii } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Spacing } from "@/lib/screen-layout";
import {
  cancelNameChangeRequest,
  fetchPendingNameChangeRequest,
  submitNameChangeRequest,
  type NameChangeRequest,
} from "@/lib/business-name-change";

/**
 * "Request a business name change" card, shown under the read-only name field
 * once a business is publicly visible (name locked server-side — see
 * lib/business-name-change.ts). Self-contained: loads the pending request,
 * files a new one, or cancels the open one.
 */
export function BusinessNameChangeCard({
  businessId,
  userId,
  currentName,
}: {
  businessId: string;
  userId: string;
  currentName: string | null;
}) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme];

  const [pending, setPending] = useState<NameChangeRequest | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [proposedName, setProposedName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; tone: "error" | "success" } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchPendingNameChangeRequest(businessId).then((request) => {
      if (!cancelled) setPending(request);
    });
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const onSubmit = useCallback(async () => {
    const proposed = proposedName.trim();
    if (proposed.length < 2) {
      setNotice({ message: t("businessSetup.nameChange.errTooShort"), tone: "error" });
      return;
    }
    setBusy(true);
    setNotice(null);
    const result = await submitNameChangeRequest({
      businessId,
      userId,
      currentName,
      proposedName: proposed,
      reason: reason.trim() || null,
    });
    setBusy(false);
    if (result.ok && result.request) {
      setPending(result.request);
      setFormOpen(false);
      setProposedName("");
      setReason("");
      setNotice({ message: t("businessSetup.nameChange.submitted"), tone: "success" });
      return;
    }
    setNotice({
      message: result.duplicate
        ? t("businessSetup.nameChange.duplicate")
        : t("businessSetup.nameChange.errSubmit"),
      tone: "error",
    });
  }, [businessId, currentName, proposedName, reason, t, userId]);

  const onCancelPending = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    setNotice(null);
    const ok = await cancelNameChangeRequest(pending.id);
    setBusy(false);
    if (ok) {
      setPending(null);
    } else {
      setNotice({ message: t("businessSetup.nameChange.errSubmit"), tone: "error" });
    }
  }, [pending, t]);

  const inputStyle = {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: Radii.lg,
    backgroundColor: theme.surface,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
    color: theme.text,
  } as const;

  return (
    <View style={{ gap: Spacing.sm }}>
      {notice ? (
        <Text
          style={{
            fontSize: 13,
            color: notice.tone === "error" ? theme.danger : theme.accentText,
          }}
        >
          {notice.message}
        </Text>
      ) : null}

      {pending ? (
        <>
          <Text style={{ fontSize: 13, opacity: 0.7, color: theme.text }}>
            {t("businessSetup.nameChange.pending", { name: pending.proposed_value })}
          </Text>
          <SecondaryButton
            title={t("businessSetup.nameChange.cancelRequest")}
            onPress={() => void onCancelPending()}
            disabled={busy}
          />
        </>
      ) : formOpen ? (
        <>
          <Text style={{ fontWeight: "700", color: theme.text }}>
            {t("businessSetup.nameChange.newNameLabel")}
          </Text>
          <TextInput
            value={proposedName}
            onChangeText={setProposedName}
            autoCapitalize="words"
            maxLength={120}
            placeholder={currentName ?? undefined}
            placeholderTextColor={theme.icon}
            style={inputStyle}
          />
          <Text style={{ fontWeight: "700", color: theme.text }}>
            {t("businessSetup.nameChange.reasonLabel")}
          </Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            maxLength={500}
            multiline
            placeholderTextColor={theme.icon}
            style={{ ...inputStyle, minHeight: 72, textAlignVertical: "top" }}
          />
          <SecondaryButton
            title={t("businessSetup.nameChange.submit")}
            onPress={() => void onSubmit()}
            disabled={busy || proposedName.trim().length < 2}
          />
          <SecondaryButton
            title={t("businessSetup.nameChange.cancel")}
            onPress={() => {
              setFormOpen(false);
              setNotice(null);
            }}
            disabled={busy}
          />
        </>
      ) : (
        <SecondaryButton
          title={t("businessSetup.nameChange.request")}
          onPress={() => {
            setFormOpen(true);
            setNotice(null);
          }}
        />
      )}
    </View>
  );
}
