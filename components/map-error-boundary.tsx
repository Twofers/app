import { Component, type ReactNode } from "react";
import { Text, View } from "react-native";
import { Colors } from "@/constants/theme";
import { Spacing } from "@/lib/screen-layout";
import { PrimaryButton } from "@/components/ui/primary-button";
import { devWarn } from "@/lib/dev-log";

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
      return (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: Spacing.xxl }}>
          <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: Spacing.md }}>
            Map unavailable
          </Text>
          <Text style={{ opacity: 0.65, textAlign: "center", lineHeight: 22, marginBottom: Spacing.lg }}>
            The map could not load. Try again or browse deals from the Home tab.
          </Text>
          <PrimaryButton
            title="Retry"
            onPress={() => this.setState({ hasError: false })}
            style={{ backgroundColor: Colors.light.primary }}
          />
        </View>
      );
    }
    return this.props.children;
  }
}
