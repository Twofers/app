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
};

const OFFER_TYPES: { id: DealEligibilityDealType; label: string; helper: string }[] = [
  {
    id: "BUY_ONE_GET_ONE_FREE",
    label: "BOGO free",
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
}: Props) {
  const eligibility = result ?? validateDealEligibility(dealEligibilityFormToInput(value));
  const activeType = OFFER_TYPES.find((opt) => opt.id === value.dealType) ?? OFFER_TYPES[0]!;
  const textOnMuted = colorScheme === "dark" ? theme.text : Gray[800];

  function set<K extends keyof DealEligibilityFormState>(key: K, nextValue: DealEligibilityFormState[K]) {
    onChange({ ...value, [key]: nextValue });
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
              "Twofer accepts BOGO free, buy-one-get-something-free, or 40%+ off one single item.",
          })}
        </Text>
      </View>

      <View style={{ gap: 8 }}>
        {OFFER_TYPES.map((opt) => {
          const selected = value.dealType === opt.id;
          return (
            <Pressable
              key={opt.id}
              onPress={() => set("dealType", opt.id)}
              style={{
                padding: 12,
                borderRadius: Radii.md,
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? theme.primary : theme.border,
                backgroundColor: selected ? theme.surface : theme.surface,
              }}
            >
              <Text style={{ fontWeight: "800", color: selected ? theme.accentText : theme.text }}>
                {t(`dealEligibility.type.${opt.id}`, { defaultValue: opt.label })}
              </Text>
              <Text style={{ marginTop: 3, color: theme.mutedText, fontSize: 12 }}>
                {t(`dealEligibility.type.${opt.id}.helper`, { defaultValue: opt.helper })}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {activeType.id === "PERCENT_OFF_SINGLE_ITEM" ? (
        <View style={{ gap: 10 }}>
          {renderTextField(
            t("dealEligibility.itemLabel", { defaultValue: "Single item" }),
            "itemDescription",
            t("dealEligibility.itemPlaceholder", { defaultValue: "Croissant" }),
          )}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <View style={{ flex: 1, minWidth: 140 }}>
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
              t("dealEligibility.itemValueLabel", { defaultValue: "Retail value" }),
              "itemRetailValue",
            )}
          </View>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {renderTextField(
            t("dealEligibility.requiredItemLabel", { defaultValue: "Customer buys" }),
            "requiredItemDescription",
            t("dealEligibility.requiredItemPlaceholder", { defaultValue: "Latte" }),
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
              t("dealEligibility.requiredValueLabel", { defaultValue: "Buy item value" }),
              "requiredItemRetailValue",
            )}
            {renderCurrencyField(
              t("dealEligibility.freeValueLabel", { defaultValue: "Free item value" }),
              "freeItemRetailValue",
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
          padding: 12,
        }}
      >
        <Text style={{ color: eligibility.eligible ? theme.success : theme.danger, fontWeight: "900" }}>
          {eligibility.eligible
            ? t("dealEligibility.validTitle", { defaultValue: "Eligible offer" })
            : t("dealEligibility.invalidTitle", { defaultValue: "Not eligible yet" })}
        </Text>
        <Text style={{ marginTop: 4, color: textOnMuted, lineHeight: 18, fontSize: 12 }}>
          {eligibility.eligible
            ? t("dealEligibility.validBody", {
                defaultValue: `Customer value is about ${eligibility.customerValuePercent ?? 40}%.`,
              })
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
