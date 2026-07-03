import { Text, TextInput, View } from "react-native";

import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { Gray, Radii } from "@/constants/theme";
import {
  dealEligibilityFormToInput,
  type DealEligibilityFormState,
} from "@/lib/deal-eligibility-form";
import {
  validateDealEligibility,
  type DealEligibilityDealType,
  type DealEligibilityResult,
} from "@/lib/deal-eligibility";

type Theme = {
  text: string;
  mutedText: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  primary: string;
  primaryText: string;
  danger: string;
  success: string;
  accentText: string;
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

type Props = {
  value: DealEligibilityFormState;
  onChange: (next: DealEligibilityFormState) => void;
  t: Translate;
  theme: Theme;
  colorScheme: "light" | "dark";
  inputAccessoryViewID?: string;
  result?: DealEligibilityResult;
  compact?: boolean;
};

const OFFER_TYPES: { id: DealEligibilityDealType; label: string; helper: string }[] = [
  {
    id: "BUY_ONE_GET_ONE_FREE",
    label: "Buy one, get one free",
    helper: "Buy one item, get one item free.",
  },
  {
    id: "BUY_ONE_GET_SOMETHING_FREE",
    label: "Free item",
    helper: "Buy one item, get a custom free item.",
  },
  {
    id: "PERCENT_OFF_SINGLE_ITEM",
    label: "40%+ off item",
    helper: "Discount one specific item.",
  },
];

function sanitizeDecimalInput(raw: string): string {
  const digitsAndDots = raw.replace(/[^\d.]/g, "");
  const firstDot = digitsAndDots.indexOf(".");
  if (firstDot === -1) return digitsAndDots;
  return `${digitsAndDots.slice(0, firstDot + 1)}${digitsAndDots
    .slice(firstDot + 1)
    .replace(/\./g, "")}`;
}

export function DealEligibilityForm({
  value,
  onChange,
  t,
  theme,
  colorScheme,
  inputAccessoryViewID,
  result,
  compact = false,
}: Props) {
  const eligibility = result ?? validateDealEligibility(dealEligibilityFormToInput(value));
  const activeType = OFFER_TYPES.find((opt) => opt.id === value.dealType) ?? OFFER_TYPES[0]!;
  const textOnMuted = colorScheme === "dark" ? theme.text : Gray[800];
  const fieldPadding = compact ? 8 : 12;
  const fieldMarginTop = compact ? 3 : 6;
  const fieldMinWidth = compact ? 112 : 140;
  const rowGap = compact ? 6 : 10;
  const fieldRowStyle = {
    flexDirection: compact ? "column" : "row",
    flexWrap: "wrap",
    gap: rowGap,
  } as const;
  const activeTypeHelper = t(`dealEligibility.type.${activeType.id}.helper`, {
    defaultValue: activeType.helper,
  });

  function set<K extends keyof DealEligibilityFormState>(key: K, nextValue: DealEligibilityFormState[K]) {
    onChange({ ...value, [key]: nextValue });
  }

  function fieldError(key: string): string | null {
    return eligibility.fieldErrors?.[key] ?? null;
  }

  function renderCurrencyField(
    label: string,
    stateKey: keyof Pick<
      DealEligibilityFormState,
      "itemRetailValue" | "requiredItemRetailValue" | "freeItemRetailValue"
    >,
    placeholder = "0.00",
  ) {
    const error = fieldError(stateKey);
    return (
      <View style={{ flex: compact ? undefined : 1, width: compact ? "100%" : undefined, minWidth: compact ? undefined : fieldMinWidth }}>
        <Text style={{ color: theme.text, fontWeight: "700", fontSize: 13 }}>{label}</Text>
        <TextInput
          value={value[stateKey]}
          onChangeText={(text) => set(stateKey, sanitizeDecimalInput(text))}
          keyboardType="decimal-pad"
          inputAccessoryViewID={inputAccessoryViewID}
          returnKeyType="done"
          placeholder={placeholder}
          placeholderTextColor={theme.mutedText}
          style={{
            borderWidth: 1,
            borderColor: error ? theme.danger : theme.border,
            borderRadius: Radii.md,
            padding: fieldPadding,
            marginTop: fieldMarginTop,
            color: theme.text,
            backgroundColor: theme.surface,
          }}
        />
        {error ? <Text style={{ marginTop: 4, color: theme.danger, fontSize: 12, lineHeight: 16 }}>{error}</Text> : null}
      </View>
    );
  }

  function renderTextField(
    label: string,
    stateKey: keyof Pick<
      DealEligibilityFormState,
      "itemDescription" | "requiredItemDescription" | "freeItemDescription"
    >,
    placeholder: string,
  ) {
    const error = fieldError(stateKey);
    return (
      <View>
        <Text style={{ color: theme.text, fontWeight: "700", fontSize: 13 }}>{label}</Text>
        <TextInput
          value={value[stateKey]}
          onChangeText={(text) => set(stateKey, text)}
          placeholder={placeholder}
          placeholderTextColor={theme.mutedText}
          style={{
            borderWidth: 1,
            borderColor: error ? theme.danger : theme.border,
            borderRadius: Radii.md,
            padding: fieldPadding,
            marginTop: fieldMarginTop,
            color: theme.text,
            backgroundColor: theme.surface,
          }}
        />
        {error ? <Text style={{ marginTop: 4, color: theme.danger, fontSize: 12, lineHeight: 16 }}>{error}</Text> : null}
      </View>
    );
  }

  function renderDiscountPercentField() {
    const error = fieldError("discountPercent");
    return (
      <View style={{ flex: compact ? undefined : 1, width: compact ? "100%" : undefined, minWidth: compact ? undefined : fieldMinWidth }}>
        <Text style={{ color: theme.text, fontWeight: "700", fontSize: 13 }}>
          {t("dealEligibility.discountLabel", { defaultValue: "Discount percent" })}
        </Text>
        <TextInput
          value={value.discountPercent}
          onChangeText={(text) => set("discountPercent", sanitizeDecimalInput(text))}
          keyboardType="decimal-pad"
          inputAccessoryViewID={inputAccessoryViewID}
          returnKeyType="done"
          placeholder="40"
          placeholderTextColor={theme.mutedText}
          style={{
            borderWidth: 1,
            borderColor: error ? theme.danger : theme.border,
            borderRadius: Radii.md,
            padding: fieldPadding,
            marginTop: fieldMarginTop,
            color: theme.text,
            backgroundColor: theme.surface,
          }}
        />
        {error ? <Text style={{ marginTop: 4, color: theme.danger, fontSize: 12, lineHeight: 16 }}>{error}</Text> : null}
      </View>
    );
  }

  function eligibleMessage() {
    if (activeType.id !== "PERCENT_OFF_SINGLE_ITEM") {
      const estimate =
        eligibility.customerValuePercent != null
          ? ` Estimated value is about ${eligibility.customerValuePercent}%.`
          : "";
      return t("dealEligibility.validFreeItemBody", {
        defaultValue: `Eligible: customers get a named item free with purchase.${estimate}`,
      });
    }
    if (eligibility.customerValuePercent == null) {
      return t("dealEligibility.validPercentBody", {
        defaultValue: "Eligible: discount is at least 40% for one item.",
      });
    }
    return t("dealEligibility.validBody", {
      defaultValue: `Customer value is about ${eligibility.customerValuePercent}%.`,
    });
  }

  return (
    <View
      style={{
        marginTop: compact ? 10 : 16,
        padding: compact ? 8 : 14,
        borderRadius: compact ? Radii.md : Radii.lg,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.surfaceMuted,
        gap: compact ? 6 : 12,
      }}
    >
      <View>
        <Text style={{ color: theme.text, fontWeight: "900", fontSize: compact ? 15 : 16 }}>
          {t("dealEligibility.title", { defaultValue: "Offer rules" })}
        </Text>
        {!compact ? (
          <Text style={{ marginTop: 4, color: theme.mutedText, lineHeight: 18, fontSize: 12 }}>
            {t("dealEligibility.helper", {
              defaultValue:
                "Twofer accepts buy-one-get-one free, buy-one-get-something-free, or 40%+ off one single item.",
            })}
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: compact ? "row" : "column", flexWrap: "wrap", gap: compact ? 5 : 8 }}>
        {OFFER_TYPES.map((opt) => {
          const selected = value.dealType === opt.id;
          return (
            <Pressable
              key={opt.id}
              onPress={() => set("dealType", opt.id)}
              style={{
                paddingHorizontal: compact ? 6 : 12,
                paddingVertical: compact ? 6 : 12,
                minHeight: compact ? 40 : undefined,
                minWidth: compact ? 0 : undefined,
                flexBasis: compact ? 0 : undefined,
                flexGrow: compact ? 1 : undefined,
                flexShrink: compact ? 1 : undefined,
                borderRadius: Radii.md,
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? theme.primary : theme.border,
                backgroundColor: selected ? theme.surface : theme.surface,
                justifyContent: "center",
              }}
            >
              <Text
                style={{
                  fontWeight: "800",
                  color: selected ? theme.accentText : theme.text,
                  fontSize: compact ? 12 : undefined,
                  lineHeight: compact ? 14 : undefined,
                  textAlign: compact ? "center" : undefined,
                }}
                numberOfLines={compact ? 2 : undefined}
                adjustsFontSizeToFit={compact}
                minimumFontScale={0.76}
              >
                {t(`dealEligibility.type.${opt.id}`, { defaultValue: opt.label })}
              </Text>
              {!compact ? (
                <Text style={{ marginTop: 3, color: theme.mutedText, fontSize: 12 }}>
                  {t(`dealEligibility.type.${opt.id}.helper`, { defaultValue: opt.helper })}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {compact ? (
        <Text style={{ color: theme.mutedText, fontSize: 11, lineHeight: 14 }} numberOfLines={1}>
          {activeTypeHelper}
        </Text>
      ) : null}

      {activeType.id === "PERCENT_OFF_SINGLE_ITEM" ? (
        <View style={{ gap: rowGap }}>
          {renderTextField(
            t("dealEligibility.itemLabel", { defaultValue: "Single item" }),
            "itemDescription",
            t("dealEligibility.itemPlaceholder", { defaultValue: "Example: croissant" }),
          )}
          <View style={fieldRowStyle}>
            {renderDiscountPercentField()}
            {renderCurrencyField(
              t("dealEligibility.itemValueLabel", { defaultValue: "Retail value (optional)" }),
              "itemRetailValue",
              t("dealEligibility.optionalMoneyPlaceholder", { defaultValue: "Optional" }),
            )}
          </View>
        </View>
      ) : (
        <View style={{ gap: rowGap }}>
          {renderTextField(
            t("dealEligibility.requiredItemLabel", { defaultValue: "Customer buys" }),
            "requiredItemDescription",
            t("dealEligibility.requiredItemPlaceholder", { defaultValue: "Example: latte" }),
          )}
          {activeType.id === "BUY_ONE_GET_SOMETHING_FREE"
            ? renderTextField(
                t("dealEligibility.freeItemLabel", { defaultValue: "Customer gets free" }),
                "freeItemDescription",
                t("dealEligibility.freeItemPlaceholder", { defaultValue: "Example: any pastry" }),
              )
            : null}
          <View style={fieldRowStyle}>
            {renderCurrencyField(
              t("dealEligibility.requiredValueLabel", { defaultValue: "Buy item value (optional)" }),
              "requiredItemRetailValue",
              t("dealEligibility.optionalMoneyPlaceholder", { defaultValue: "Optional" }),
            )}
            {renderCurrencyField(
              t("dealEligibility.freeValueLabel", { defaultValue: "Free item value (optional)" }),
              "freeItemRetailValue",
              t("dealEligibility.optionalMoneyPlaceholder", { defaultValue: "Optional" }),
            )}
          </View>
        </View>
      )}

      <View
        style={{
          borderRadius: Radii.md,
          borderWidth: 1,
          borderColor: eligibility.eligible ? theme.success : theme.danger,
          backgroundColor: theme.surface,
          padding: compact ? 8 : 12,
        }}
      >
        <Text style={{ color: eligibility.eligible ? theme.success : theme.danger, fontWeight: "900" }}>
          {eligibility.eligible
            ? t("dealEligibility.validTitle", { defaultValue: "Eligible offer" })
            : t("dealEligibility.invalidTitle", { defaultValue: "Not eligible yet" })}
        </Text>
        <Text
          style={{ marginTop: 4, color: textOnMuted, lineHeight: compact ? 17 : 18, fontSize: 12 }}
          numberOfLines={compact ? 2 : undefined}
        >
          {eligibility.eligible
            ? eligibleMessage()
            : eligibility.message ??
              t("dealEligibility.invalidBody", {
                defaultValue:
                  "Twofer deals must be free-item offers or at least 40% off one single item.",
              })}
        </Text>
      </View>
    </View>
  );
}
