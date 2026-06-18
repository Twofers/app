import { Text, TextInput, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

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
  primaryItemValue?: string;
  showValidation?: boolean;
  showSuccess?: boolean;
  onInteracted?: () => void;
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
  primaryItemValue,
  showValidation = true,
  showSuccess = true,
  onInteracted,
}: Props) {
  const eligibility = result ?? validateDealEligibility(dealEligibilityFormToInput(value));
  const activeType = OFFER_TYPES.find((opt) => opt.id === value.dealType) ?? OFFER_TYPES[0]!;
  const textOnMuted = colorScheme === "dark" ? theme.text : Gray[800];
  const hasPrimaryItem = primaryItemValue != null;

  function set<K extends keyof DealEligibilityFormState>(key: K, nextValue: DealEligibilityFormState[K]) {
    onChange({ ...value, [key]: nextValue });
  }

  function touch() {
    onInteracted?.();
  }

  function renderCurrencyField(
    label: string,
    stateKey: keyof Pick<
      DealEligibilityFormState,
      "itemRetailValue" | "requiredItemRetailValue" | "freeItemRetailValue"
    >,
    placeholder = "0.00",
  ) {
    return (
      <View style={{ flex: 1, minWidth: 140 }}>
        <Text style={{ color: theme.text, fontWeight: "700", fontSize: 13 }}>{label}</Text>
        <TextInput
          value={value[stateKey]}
          onChangeText={(text) => set(stateKey, sanitizeDecimalInput(text))}
          onBlur={touch}
          keyboardType="decimal-pad"
          inputAccessoryViewID={inputAccessoryViewID}
          returnKeyType="done"
          placeholder={placeholder}
          placeholderTextColor={theme.mutedText}
          style={{
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: Radii.md,
            padding: 12,
            marginTop: 6,
            color: theme.text,
            backgroundColor: theme.surface,
          }}
        />
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
    return (
      <View>
        <Text style={{ color: theme.text, fontWeight: "700", fontSize: 13 }}>{label}</Text>
        <TextInput
          value={value[stateKey]}
          onChangeText={(text) => set(stateKey, text)}
          onBlur={touch}
          placeholder={placeholder}
          placeholderTextColor={theme.mutedText}
          style={{
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: Radii.md,
            padding: 12,
            marginTop: 6,
            color: theme.text,
            backgroundColor: theme.surface,
          }}
        />
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
      percent: eligibility.customerValuePercent,
      defaultValue: `Customer value is about ${eligibility.customerValuePercent}%.`,
    });
  }

  return (
    <View
      style={{
        marginTop: 16,
        padding: 14,
        borderRadius: Radii.lg,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.surfaceMuted,
        gap: 12,
      }}
    >
      <View>
        <Text style={{ color: theme.text, fontWeight: "900", fontSize: 16 }}>
          {t("dealEligibility.title", { defaultValue: "Offer rules" })}
        </Text>
        <Text style={{ marginTop: 4, color: theme.mutedText, lineHeight: 18, fontSize: 12 }}>
          {t("dealEligibility.helper", {
            defaultValue:
              "Twofer accepts buy-one-get-one free, buy-one-get-something-free, or 40%+ off one single item.",
          })}
        </Text>
      </View>

      <View
        style={{
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: Radii.md,
          backgroundColor: theme.surface,
          overflow: "hidden",
        }}
      >
        {OFFER_TYPES.map((opt) => {
          const selected = value.dealType === opt.id;
          return (
            <Pressable
              key={opt.id}
              onPress={() => {
                set("dealType", opt.id);
                touch();
              }}
              style={{
                padding: 12,
                borderTopWidth: opt.id === OFFER_TYPES[0]?.id ? 0 : 1,
                borderTopColor: theme.border,
                borderLeftWidth: selected ? 3 : 0,
                borderLeftColor: selected ? theme.primary : "transparent",
                backgroundColor: selected ? theme.surfaceMuted : theme.surface,
                flexDirection: "row",
                alignItems: "flex-start",
                gap: 10,
              }}
            >
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  borderWidth: selected ? 0 : 1.5,
                  borderColor: selected ? theme.primary : theme.border,
                  backgroundColor: selected ? theme.primary : theme.surface,
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 1,
                }}
              >
                {selected ? <MaterialIcons name="check" size={16} color={theme.primaryText} /> : null}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontWeight: "800", color: selected ? theme.accentText : theme.text, lineHeight: 20 }}>
                  {t(`dealEligibility.type.${opt.id}`, { defaultValue: opt.label })}
                </Text>
                <Text style={{ marginTop: 3, color: theme.mutedText, fontSize: 12, lineHeight: 17 }}>
                  {t(`dealEligibility.typeHelper.${opt.id}`, { defaultValue: opt.helper })}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {activeType.id === "PERCENT_OFF_SINGLE_ITEM" ? (
        <View style={{ gap: 10 }}>
          {hasPrimaryItem
            ? null
            : renderTextField(
                t("dealEligibility.itemLabel", { defaultValue: "Item" }),
                "itemDescription",
                t("dealEligibility.itemPlaceholder", { defaultValue: "Oat milk latte" }),
              )}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <View style={{ flex: 1, minWidth: 140 }}>
              <Text style={{ color: theme.text, fontWeight: "700", fontSize: 13 }}>
                {t("dealEligibility.discountLabel", { defaultValue: "Percent off" })}
              </Text>
              <TextInput
                value={value.discountPercent}
                onChangeText={(text) => set("discountPercent", sanitizeDecimalInput(text))}
                onBlur={touch}
                keyboardType="decimal-pad"
                inputAccessoryViewID={inputAccessoryViewID}
                returnKeyType="done"
                placeholder="40"
                placeholderTextColor={theme.mutedText}
                style={{
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: Radii.md,
                  padding: 12,
                  marginTop: 6,
                  color: theme.text,
                  backgroundColor: theme.surface,
                }}
              />
            </View>
            {renderCurrencyField(
              t("dealEligibility.itemValueLabel", { defaultValue: "Regular price (optional)" }),
              "itemRetailValue",
            )}
          </View>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {hasPrimaryItem
            ? null
            : renderTextField(
                t("dealEligibility.requiredItemLabel", { defaultValue: "Item" }),
                "requiredItemDescription",
                t("dealEligibility.requiredItemPlaceholder", { defaultValue: "Oat milk latte" }),
              )}
          {activeType.id === "BUY_ONE_GET_SOMETHING_FREE"
            ? renderTextField(
                t("dealEligibility.freeItemLabel", { defaultValue: "Customer gets free" }),
                "freeItemDescription",
                t("dealEligibility.freeItemPlaceholder", { defaultValue: "Any pastry" }),
              )
            : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {renderCurrencyField(
              t("dealEligibility.requiredValueLabel", { defaultValue: "Regular price (optional)" }),
              "requiredItemRetailValue",
            )}
            {activeType.id === "BUY_ONE_GET_SOMETHING_FREE"
              ? renderCurrencyField(
                  t("dealEligibility.freeValueLabel", { defaultValue: "Free item regular price (optional)" }),
                  "freeItemRetailValue",
                )
              : null}
          </View>
        </View>
      )}

      {eligibility.eligible && showSuccess ? (
        <View
          style={{
            borderRadius: Radii.md,
            borderWidth: 1,
            borderColor: theme.success,
            backgroundColor: theme.surface,
            padding: 12,
          }}
        >
          <Text style={{ color: theme.success, fontWeight: "900" }}>
            {t("dealEligibility.validTitle", { defaultValue: "Offer type ready" })}
          </Text>
          <Text style={{ marginTop: 4, color: textOnMuted, lineHeight: 18, fontSize: 12 }}>
            {eligibleMessage()}
          </Text>
        </View>
      ) : null}

      {!eligibility.eligible && showValidation ? (
        <Text style={{ color: theme.danger, fontWeight: "700", fontSize: 13, lineHeight: 18 }}>
          {eligibility.reasonCode === "MISSING_REQUIRED_ITEM"
            ? t("dealEligibility.missingItem", { defaultValue: "Add the item this discount applies to." })
            : eligibility.message ??
              t("dealEligibility.invalidBody", {
                defaultValue: "Twofer offers must be a free item or at least 40% off one item.",
              })}
        </Text>
      ) : null}
    </View>
  );
}
