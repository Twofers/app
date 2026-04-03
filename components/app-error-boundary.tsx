import { Component, type ReactNode } from "react";
import { Text, View } from "react-native";
import { Spacing } from "@/lib/screen-layout";
import { Colors } from "@/constants/theme";
import { PrimaryButton } from "@/components/ui/primary-button";
import i18n from "@/lib/i18n/config";

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    if (__DEV__) console.warn("[AppErrorBoundary]", error);
  }

  render() {
    if (this.state.hasError) {
      const t = (key: string) => i18n.t(key);
      return (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: Spacing.xxl, backgroundColor: "#fff" }}>
          <Text style={{ fontSize: 22, fontWeight: "700", marginBottom: Spacing.md, color: Colors.light.text }}>
            {t("errorBoundary.title")}
          </Text>
          <Text style={{ opacity: 0.65, textAlign: "center", lineHeight: 22, marginBottom: Spacing.lg, fontSize: 16, color: Colors.light.text }}>
            {t("errorBoundary.body")}
          </Text>
          <PrimaryButton
            title={t("errorBoundary.retry")}
            onPress={() => this.setState({ hasError: false })}
          />
        </View>
      );
    }
    return this.props.children;
  }
}
