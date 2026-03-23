import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";
import * as Notifications from "expo-notifications";
import { getAlertsEnabled, setAlertsEnabled } from "../../lib/notifications";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";

export default function SettingsScreen() {
  const { top, horizontal, scrollBottom } = useScreenInsets("tab");
  const [alertsEnabled, setAlertsEnabledState] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const enabled = await getAlertsEnabled();
      setAlertsEnabledState(enabled);
      setLoading(false);
    })();
  }, []);

  async function toggleAlerts(next: boolean) {
    if (next) {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission required", "Please enable notifications to receive deal alerts.");
        return;
      }
    }
    await setAlertsEnabled(next);
    setAlertsEnabledState(next);
  }

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>Settings</Text>

      <ScrollView
        style={{ flex: 1, marginTop: Spacing.lg }}
        contentContainerStyle={{ paddingBottom: scrollBottom }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={{
            borderWidth: 1,
            borderColor: "#e5e5e5",
            borderRadius: 16,
            padding: Spacing.lg,
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: Spacing.md,
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontWeight: "700", fontSize: 17 }}>Deal alerts</Text>
            <Text style={{ opacity: 0.7, marginTop: Spacing.sm, fontSize: 15, lineHeight: 22 }}>
              Notify me when favorites post new deals.
            </Text>
          </View>
          <Switch value={alertsEnabled} onValueChange={toggleAlerts} disabled={loading} />
        </View>

        <Pressable
          onPress={async () => {
            const enabled = await getAlertsEnabled();
            Alert.alert("Deal alerts", enabled ? "Enabled" : "Disabled");
          }}
          style={{
            marginTop: Spacing.lg,
            paddingVertical: Spacing.md + 2,
            borderRadius: 14,
            backgroundColor: "#111",
          }}
        >
          <Text style={{ color: "white", fontWeight: "700", textAlign: "center", fontSize: 16 }}>
            Check alerts status
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
