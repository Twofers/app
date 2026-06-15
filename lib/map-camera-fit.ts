type MarkerLite = { id: string; lat: number; lng: number };
export type MapFitCoordinate = { latitude: number; longitude: number };

function roundCoord(value: number): string {
  if (!Number.isFinite(value)) return "nan";
  return value.toFixed(4);
}

export function buildMapCameraFitSignature(params: {
  userPos: { lat: number; lng: number } | null;
  markers: MarkerLite[];
}): string {
  const userPart = params.userPos
    ? `u:${roundCoord(params.userPos.lat)},${roundCoord(params.userPos.lng)}`
    : "u:none";
  const markerPart = params.markers
    .map((m) => `${m.id}:${roundCoord(m.lat)},${roundCoord(m.lng)}`)
    .sort((a, b) => a.localeCompare(b))
    .join("|");
  return `${userPart};m:${markerPart}`;
}

function isFiniteLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng);
}

export function buildMapFitCoordinates(params: {
  userPos: { lat: number; lng: number } | null;
  markers: MarkerLite[];
}): MapFitCoordinate[] {
  const out: MapFitCoordinate[] = [];
  if (params.userPos && isFiniteLatLng(params.userPos.lat, params.userPos.lng)) {
    out.push({ latitude: params.userPos.lat, longitude: params.userPos.lng });
  }
  for (const marker of params.markers) {
    if (!isFiniteLatLng(marker.lat, marker.lng)) continue;
    out.push({ latitude: marker.lat, longitude: marker.lng });
  }
  return out;
}
