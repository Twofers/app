import { Platform, View } from "react-native";
import Constants from "expo-constants";
import { useTranslation } from "react-i18next";
import { MapErrorBoundary } from "@/components/map-error-boundary";
import { EmptyState } from "@/components/ui/empty-state";
import { useScreenInsets } from "@/lib/screen-layout";
import MapScreenNative from "@/components/map/map-native-screen";

/**
 * Gate the Google Maps key check at the tab level so the MapErrorBoundary
 * can show a friendly fallback when the key is missing or invalid.
 * The native MapView crash bypasses React error boundaries, so we also
 * rely on the JS guard inside MapScreenNative for belt-and-suspenders.
 */
export default function MapScreen() {
  const { t } = useTranslation();
  const { horizontal } = useScreenInsets("tab");
  const androidMapsOk =
    Platform.OS !== "android" || Boolean(Constants.expoConfig?.extra?.androidMapsKeyConfigured);

  if (!androidMapsOk) {
    return (
      <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: horizontal }}>
        <EmptyState
          title={t("consumerMap.androidMapsUnavailableTitle")}
          message={t("consumerMap.androidMapsUnavailableBody")}
        />
      </View>
    );
  }

  return (
    <MapErrorBoundary>
      <MapScreenNative />
    </MapErrorBoundary>
  );
}
