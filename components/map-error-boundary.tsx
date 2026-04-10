import { Component, type ReactNode } from "react";
import { Appearance, Text, View } from "react-native";
import { Colors } from "@/constants/theme";
import { Spacing } from "@/lib/screen-layout";
import { PrimaryButton } from "@/components/ui/primary-button";
import { devWarn } from "@/lib/dev-log";
// FIX: Import i18n directly for class component (can't use useTranslation hook)
import i18n from "@/lib/i18n/config";

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class MapErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    devWarn("[MapErrorBoundary]", error);
  }

  render() {
    if (this.state.hasError) {
      const scheme = Appearance.getColorScheme() === "dark" ? "dark" : "light";
      const theme = Colors[scheme];
      return (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: Spacing.xxl, backgroundColor: theme.background }}>
          <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: Spacing.md, color: theme.text }}>
            {i18n.t("errorBoundary.mapTitle")}
          </Text>
          <Text style={{ opacity: 0.65, textAlign: "center", lineHeight: 22, marginBottom: Spacing.lg, color: theme.text }}>
            {i18n.t("errorBoundary.mapBody")}
          </Text>
          <PrimaryButton
            title={i18n.t("errorBoundary.mapRetry")}
            onPress={() => this.setState({ hasError: false })}
            style={{ backgroundColor: theme.primary }}
          />
        </View>
      );
    }
    return this.props.children;
  }
}
