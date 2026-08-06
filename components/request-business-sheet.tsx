import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { Banner } from "@/components/ui/banner";
import { Colors, Radii } from "@/constants/theme";
import { getBottomSheetBottomPadding, Spacing } from "@/lib/screen-layout";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { translateApiError } from "@/lib/i18n/api-messages";
import {
  requestBusinessOnTwofer,
  searchLocalBusinesses,
  type LocalBusinessSearchResult,
} from "@/lib/request-business";

type Props = {
  visible: boolean;
  onDismiss: () => void;
  /** Tags which surface opened the sheet (analytics-style provenance for the demand signal). */
  sourceSurface: string;
};

const SEARCH_DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;

/**
 * "Don't see your spot? Request it." — wires up `request-business-on-twofer`,
 * a deployed edge function with no prior client caller. That function only
 * accepts an existing `business_id`/`prospect_id`, never a free-text name, so
 * this is a search-and-select flow (via `public-local-businesses`, also
 * previously unused from the client) rather than a plain text form.
 */
export function RequestBusinessSheet({ visible, onDismiss, sourceSurface }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const sheetBottomPadding = getBottomSheetBottomPadding(insets);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LocalBusinessSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<LocalBusinessSearchResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ name: string; deduped: boolean } | null>(null);
  const searchSeqRef = useRef(0);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setResults([]);
      setSearching(false);
      setSearched(false);
      setSelected(null);
      setSubmitting(false);
      setError(null);
      setSuccess(null);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const trimmed = query.trim();
    setSelected(null);
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearching(false);
      setSearched(false);
      return;
    }
    const seq = ++searchSeqRef.current;
    setSearching(true);
    const timer = setTimeout(() => {
      void searchLocalBusinesses(trimmed)
        .then((rows) => {
          if (searchSeqRef.current !== seq) return;
          setResults(rows);
          setSearched(true);
        })
        .catch((err: unknown) => {
          if (searchSeqRef.current !== seq) return;
          setResults([]);
          setSearched(true);
          setError(translateApiError({ message: err instanceof Error ? err.message : String(err) }, t));
        })
        .finally(() => {
          if (searchSeqRef.current === seq) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, visible, t]);

  async function handleSubmit() {
    if (!selected || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const target = selected.record_type === "business" ? { businessId: selected.id } : { prospectId: selected.id };
      const out = await requestBusinessOnTwofer(target, { sourceSurface });
      setSuccess({ name: selected.display_name, deduped: out.deduped });
    } catch (err: unknown) {
      setError(translateApiError({ message: err instanceof Error ? err.message : String(err) }, t));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" accessibilityViewIsModal onRequestClose={onDismiss}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.5)",
          paddingTop: insets.top + Spacing.xl,
          paddingBottom: sheetBottomPadding,
        }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View
            style={{
              flex: 1,
              backgroundColor: theme.background,
              borderTopLeftRadius: Radii.lg,
              borderTopRightRadius: Radii.lg,
              overflow: "hidden",
            }}
          >
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl }}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets
              keyboardDismissMode="interactive"
            >
              <Text style={{ fontSize: 22, fontWeight: "800", color: theme.text }}>
                {t("requestBusiness.title")}
              </Text>

              {success ? (
                <View style={{ gap: Spacing.md }}>
                  <Banner
                    message={
                      success.deduped
                        ? t("requestBusiness.alreadyRequestedBody", { name: success.name })
                        : t("requestBusiness.successBody", { name: success.name })
                    }
                    tone="success"
                  />
                  <PrimaryButton title={t("requestBusiness.close")} onPress={onDismiss} />
                </View>
              ) : (
                <>
                  <Text style={{ fontSize: 14, lineHeight: 20, opacity: 0.78, color: theme.text }}>
                    {t("requestBusiness.subtitle")}
                  </Text>

                  {error ? <Banner message={error} tone="error" /> : null}

                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder={t("requestBusiness.searchPlaceholder")}
                    placeholderTextColor={theme.mutedText}
                    autoCorrect={false}
                    autoCapitalize="words"
                    maxLength={120}
                    editable={!submitting}
                    style={{
                      borderWidth: 1,
                      borderColor: theme.border,
                      borderRadius: Radii.md,
                      backgroundColor: theme.surface,
                      padding: Spacing.md,
                      fontSize: 16,
                      color: theme.text,
                    }}
                  />

                  {searching ? (
                    <View style={{ alignItems: "center", paddingVertical: Spacing.sm }}>
                      <ActivityIndicator color={theme.primary} />
                    </View>
                  ) : searched && results.length === 0 ? (
                    <Text style={{ fontSize: 13, opacity: 0.7, color: theme.text }}>
                      {t("requestBusiness.noResults")}
                    </Text>
                  ) : null}

                  {!searching && results.length > 0 ? (
                    <View style={{ gap: Spacing.sm }}>
                      {results.map((row) => {
                        const isSelected = selected?.id === row.id;
                        return (
                          <Pressable
                            key={row.id}
                            onPress={() => setSelected(row)}
                            disabled={submitting}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: isSelected }}
                            style={({ pressed }) => ({
                              paddingVertical: Spacing.md,
                              paddingHorizontal: Spacing.lg,
                              borderRadius: Radii.md,
                              borderWidth: isSelected ? 2 : 1,
                              borderColor: isSelected ? theme.primary : theme.border,
                              backgroundColor: isSelected
                                ? colorScheme === "dark"
                                  ? "rgba(255,159,28,0.18)"
                                  : "rgba(255,159,28,0.1)"
                                : pressed
                                  ? theme.surfaceMuted
                                  : theme.surface,
                            })}
                          >
                            <Text style={{ fontWeight: isSelected ? "800" : "600", color: theme.text, fontSize: 15 }} numberOfLines={1}>
                              {row.display_name}
                            </Text>
                            {row.coarse_location ? (
                              <Text style={{ marginTop: 2, fontSize: 12, opacity: 0.65, color: theme.text }} numberOfLines={1}>
                                {row.coarse_location}
                              </Text>
                            ) : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}

                  <View style={{ marginTop: Spacing.lg, gap: Spacing.sm }}>
                    <PrimaryButton
                      title={submitting ? t("requestBusiness.submitting") : t("requestBusiness.submit")}
                      onPress={() => void handleSubmit()}
                      disabled={submitting || !selected}
                    />
                    <SecondaryButton title={t("requestBusiness.cancel")} onPress={onDismiss} disabled={submitting} />
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
