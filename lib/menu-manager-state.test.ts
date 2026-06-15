import { describe, expect, it } from "vitest";
import { getMenuManagerViewState } from "./menu-manager-state";

describe("menu manager view state", () => {
  it("marks an active library with no active rows as empty", () => {
    const state = getMenuManagerViewState([], false);

    expect(state.visibleRows).toEqual([]);
    expect(state.isActiveEmpty).toBe(true);
    expect(state.isArchivedEmpty).toBe(false);
    expect(state.showRestoreActions).toBe(false);
  });

  it("shows only active rows in the active library", () => {
    const active = { id: "active", archived_at: null };
    const archived = { id: "archived", archived_at: "2026-06-15T12:00:00Z" };

    const state = getMenuManagerViewState([active, archived], false);

    expect(state.visibleRows).toEqual([active]);
    expect(state.isActiveEmpty).toBe(false);
  });

  it("shows archived empty state without restore actions when no rows are archived", () => {
    const state = getMenuManagerViewState([{ id: "active", archived_at: null }], true);

    expect(state.visibleRows).toEqual([]);
    expect(state.isArchivedEmpty).toBe(true);
    expect(state.showRestoreActions).toBe(false);
  });

  it("shows restore actions only when archived rows exist", () => {
    const archived = { id: "archived", archived_at: "2026-06-15T12:00:00Z" };
    const state = getMenuManagerViewState([archived], true);

    expect(state.visibleRows).toEqual([archived]);
    expect(state.showRestoreActions).toBe(true);
  });
});
