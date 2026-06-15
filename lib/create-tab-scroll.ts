export const CREATE_TAB_EXPANDED_BOTTOM_GAP = 24;
export const CREATE_TAB_EXPAND_SCROLL_OFFSET = 16;

export function getCreateTabScrollBottom(baseScrollBottom: number): number {
  return Math.max(0, baseScrollBottom) + CREATE_TAB_EXPANDED_BOTTOM_GAP;
}

export function getExpandedSectionScrollY(sectionY: number): number {
  if (!Number.isFinite(sectionY)) return 0;
  return Math.max(0, Math.round(sectionY) - CREATE_TAB_EXPAND_SCROLL_OFFSET);
}
