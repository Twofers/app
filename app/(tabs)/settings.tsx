import { useEffect, useState } from "react";
import { Alert, Pressable, Switch, Text, View } from "react-native";
import * as Notifications from "expo-notifications";
import { getAlertsEnabled, setAlertsEnabled } from "../../lib/notifications";

export default function SettingsScreen() {
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
    <View style={{ paddingTop: 70, paddingHorizontal: 16, flex: 1 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>Settings</Text>

      <View
        style={{
          marginTop: 16,
          borderWidth: 1,
          borderColor: "#ddd",
          borderRadius: 12,
          padding: 12,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <View>
          <Text style={{ fontWeight: "700" }}>Deal alerts</Text>
          <Text style={{ opacity: 0.7, marginTop: 4 }}>
            Notify me when favorites post new deals.
          </Text>
        </View>
        <Switch
          value={alertsEnabled}
          onValueChange={toggleAlerts}
          disabled={loading}
        />
      </View>

      <Pressable
        onPress={async () => {
          const enabled = await getAlertsEnabled();
          Alert.alert("Deal alerts", enabled ? "Enabled" : "Disabled");
        }}
        style={{
          marginTop: 16,
          padding: 12,
          borderRadius: 12,
          backgroundColor: "#111",
        }}
      >
        <Text style={{ color: "white", fontWeight: "700", textAlign: "center" }}>
          Check alerts status
        </Text>
      </Pressable>
    </View>
  );
}
