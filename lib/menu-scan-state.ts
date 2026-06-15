export type MenuScanState =
  | "idle"
  | "pickingPhoto"
  | "analyzing"
  | "success"
  | "emptyResult"
  | "error";

export function isMenuScanBusy(state: MenuScanState): boolean {
  return state === "pickingPhoto" || state === "analyzing";
}

export function getMenuScanEmptyStateKey(state: MenuScanState): string | null {
  if (isMenuScanBusy(state)) return null;
  if (state === "emptyResult") return "menuScan.emptyExtract";
  if (state === "error") return "menuScan.errorEmptyState";
  return "menuScan.idleEmptyState";
}

export function shouldShowAppendMenuPhotoActions(rowCount: number): boolean {
  return rowCount > 0;
}
