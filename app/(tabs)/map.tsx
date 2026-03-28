import { MapErrorBoundary } from "@/components/map-error-boundary";
import MapScreenNative from "./map.native-impl";

export default function MapScreen() {
  return (
    <MapErrorBoundary>
      <MapScreenNative />
    </MapErrorBoundary>
  );
}
