type MarkerLite = { id: string; lat: number; lng: number };

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
