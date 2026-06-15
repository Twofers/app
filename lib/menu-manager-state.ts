type MenuManagerRowLike = {
  archived_at?: string | null;
};

export function getMenuManagerViewState<T extends MenuManagerRowLike>(rows: readonly T[], showArchived: boolean) {
  const activeRows = rows.filter((row) => !row.archived_at);
  const archivedRows = rows.filter((row) => Boolean(row.archived_at));
  const visibleRows = showArchived ? archivedRows : activeRows;

  return {
    activeRows,
    archivedRows,
    visibleRows,
    isActiveEmpty: !showArchived && activeRows.length === 0,
    isArchivedEmpty: showArchived && archivedRows.length === 0,
    showRestoreActions: showArchived && archivedRows.length > 0,
  };
}
