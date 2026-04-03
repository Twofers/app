import { Component, type ErrorInfo, type ReactNode } from "react";
import { Platform, StatusBar, StyleSheet, Text, View } from "react-native";
import { reloadAppAsync } from "expo";
import { Ionicons } from "@expo/vector-icons";

import { PrimaryButton } from "@/components/ui/primary-button";
import { Colors } from "@/constants/theme";
import { captureError } from "@/lib/sentry";
import i18n from "@/lib/i18n/config";

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class GlobalErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[GlobalErrorBoundary]", error);
    captureError(error, {
      boundary: "global",
      componentStack: errorInfo.componentStack ?? "",
    });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const topPad = Platform.OS === "android" ? (StatusBar.currentHeight ?? 24) : 44;

    return (
      <View style={[styles.container, { paddingTop: topPad + 24 }]}>
        <Ionicons
          name="warning-outline"
          size={64}
          color={Colors.light.primary}
          style={styles.icon}
        />
        <Text style={styles.title}>
          {i18n.t("crashScreen.title")}
        </Text>
        <Text style={styles.body}>
          {i18n.t("crashScreen.body")}
        </Text>
        <PrimaryButton
          title={i18n.t("crashScreen.restart")}
          onPress={() => reloadAppAsync()}
          style={styles.button}
        />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  icon: {
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.light.text,
    marginBottom: 12,
    textAlign: "center",
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: Colors.light.mutedText,
    textAlign: "center",
    marginBottom: 32,
  },
  button: {
    backgroundColor: Colors.light.primary,
    minWidth: 180,
  },
});
