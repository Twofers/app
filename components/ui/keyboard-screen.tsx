import { useHeaderHeight } from "@react-navigation/elements";
import { Colors, Gray } from "@/constants/theme";
import {
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
  type KeyboardAvoidingViewProps,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Added to iOS offset (stack header height comes from useHeaderHeight). */
  keyboardVerticalOffsetExtra?: number;
} & Omit<KeyboardAvoidingViewProps, "behavior" | "keyboardVerticalOffset" | "children" | "style">;

/**
 * Wrap screens with TextInputs so the keyboard does not cover fields.
 * Use with ScrollView / FlatList `{...FORM_SCROLL_KEYBOARD_PROPS}`.
 */
export function KeyboardScreen({ children, style, keyboardVerticalOffsetExtra = 0, ...rest }: Props) {
  const headerHeight = useHeaderHeight();
  const offset =
    Platform.OS === "ios" ? Math.max(0, headerHeight + keyboardVerticalOffsetExtra) : 0;

  return (
    <KeyboardAvoidingView
      style={[{ flex: 1 }, style]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={offset}
      {...rest}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

/** Spread onto ScrollView or FlatList (supported on both in recent RN). */
export const FORM_SCROLL_KEYBOARD_PROPS: Pick<
  ScrollViewProps,
  "keyboardShouldPersistTaps" | "automaticallyAdjustKeyboardInsets" | "keyboardDismissMode"
> = {
  keyboardShouldPersistTaps: "handled",
  automaticallyAdjustKeyboardInsets: true,
  keyboardDismissMode: "interactive",
};

export const IOS_DONE_INPUT_ACCESSORY_ID = "twofer-ios-done-input-accessory";

export function IosDoneInputAccessory({ label = "Done", onPress }: { label?: string; onPress?: () => void }) {
  if (Platform.OS !== "ios") return null;
  const handlePress = onPress ?? Keyboard.dismiss;
  return (
    <InputAccessoryView nativeID={IOS_DONE_INPUT_ACCESSORY_ID}>
      <View
        style={{
          minHeight: 44,
          alignItems: "flex-end",
          justifyContent: "center",
          borderTopWidth: 1,
          borderTopColor: Gray[300],
          backgroundColor: Gray[50],
          paddingHorizontal: 12,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={handlePress}
          style={{ minHeight: 36, justifyContent: "center", paddingHorizontal: 12 }}
        >
          <Text style={{ color: Colors.light.accentText, fontSize: 16, fontWeight: "700" }} numberOfLines={1} maxFontSizeMultiplier={1.15}>
            {label}
          </Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}
