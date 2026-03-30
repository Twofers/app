import { MapErrorBoundary } from "@/components/map-error-boundary";
import MapScreenNative from "@/components/map/map-native-screen";

export default function MapScreen() {
  return (
    <MapErrorBoundary>
      <MapScreenNative />
    </MapErrorBoundary>
  );
}
