import { useHeaderHeight } from "@react-navigation/elements";
import {
  KeyboardAvoidingView,
  Platform,
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
