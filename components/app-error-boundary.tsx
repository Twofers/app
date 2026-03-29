import { Component, type ReactNode } from "react";
import { Appearance, Text, View } from "react-native";
import { Colors } from "@/constants/theme";
import { Spacing } from "@/lib/screen-layout";
import { PrimaryButton } from "@/components/ui/primary-button";
import { devWarn } from "@/lib/dev-log";

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    devWarn("[AppErrorBoundary]", error);
  }

  render() {
    if (this.state.hasError) {
      const scheme = Appearance.getColorScheme() === "dark" ? "dark" : "light";
      const theme = Colors[scheme];
      return (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            padding: Spacing.xxl,
            backgroundColor: theme.background,
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: Spacing.md, color: theme.text }}>
            Something went wrong
          </Text>
          <Text style={{ opacity: 0.65, textAlign: "center", lineHeight: 22, marginBottom: Spacing.lg, color: theme.text }}>
            The app hit an unexpected error. You can try again.
          </Text>
          <PrimaryButton
            title="Try again"
            onPress={() => this.setState({ hasError: false })}
            style={{ backgroundColor: theme.primary }}
          />
        </View>
      );
    }
    return this.props.children;
  }
}
