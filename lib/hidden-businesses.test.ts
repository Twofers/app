import { beforeEach, describe, expect, it, vi } from "vitest";

// hidden-businesses.ts hits the supabase client for every call, so stub a small
// chainable query builder. Each filter method returns the same thenable builder,
// which resolves to a per-test configured result — mirroring PostgREST, where the
// builder is awaitable at any point in the chain.
const h = vi.hoisted(() => {
  const state = {
    selectResult: { data: null as unknown, error: null as unknown },
    upsertResult: { error: null as unknown },
    deleteResult: { error: null as unknown },
    upsertArgs: undefined as { values: unknown; opts: unknown } | undefined,
    eqArgs: [] as Array<[string, unknown]>,
    orderArgs: undefined as { col: string; opts: unknown } | undefined,
    fromTables: [] as string[],
  };

  const makeBuilder = (getResult: () => unknown) => {
    const builder: Record<string, unknown> = {
      eq: vi.fn((col: string, val: unknown) => {
        state.eqArgs.push([col, val]);
        return builder;
      }),
      order: vi.fn((col: string, opts: unknown) => {
        state.orderArgs = { col, opts };
        return builder;
      }),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(getResult()).then(resolve, reject),
    };
    return builder;
  };

  const from = vi.fn((table: string) => {
    state.fromTables.push(table);
    return {
      select: vi.fn(() => makeBuilder(() => state.selectResult)),
      upsert: vi.fn((values: unknown, opts: unknown) => {
        state.upsertArgs = { values, opts };
        return Promise.resolve(state.upsertResult);
      }),
      delete: vi.fn(() => makeBuilder(() => state.deleteResult)),
    };
  });

  return { state, from };
});

vi.mock("@/lib/supabase", () => ({ supabase: { from: h.from } }));

import {
  hideBusiness,
  loadHiddenBusinessIds,
  loadHiddenBusinessesWithNames,
  unhideBusiness,
} from "./hidden-businesses";

beforeEach(() => {
  h.state.selectResult = { data: null, error: null };
  h.state.upsertResult = { error: null };
  h.state.deleteResult = { error: null };
  h.state.upsertArgs = undefined;
  h.state.eqArgs = [];
  h.state.orderArgs = undefined;
  h.state.fromTables = [];
  h.from.mockClear();
});

describe("loadHiddenBusinessIds", () => {
  it("returns an empty set for a signed-out user without touching supabase", async () => {
    const result = await loadHiddenBusinessIds(null);
    expect(result.size).toBe(0);
    expect(h.from).not.toHaveBeenCalled();
  });

  it("collects the hidden business ids and skips null rows", async () => {
    h.state.selectResult = {
      data: [{ business_id: "b1" }, { business_id: "b2" }, { business_id: null }],
      error: null,
    };
    const result = await loadHiddenBusinessIds("u1");
    expect([...result].sort()).toEqual(["b1", "b2"]);
    expect(h.state.fromTables).toContain("hidden_businesses");
    expect(h.state.eqArgs).toContainEqual(["user_id", "u1"]);
  });

  it("fails open to an empty set on error", async () => {
    h.state.selectResult = { data: null, error: { message: "boom" } };
    const result = await loadHiddenBusinessIds("u1");
    expect(result.size).toBe(0);
  });
});

describe("hideBusiness", () => {
  it("upserts the row (ignoring duplicates) and reports ok", async () => {
    const result = await hideBusiness({ userId: "u1", businessId: "b1" });
    expect(result.ok).toBe(true);
    expect(h.state.upsertArgs?.values).toEqual({ user_id: "u1", business_id: "b1" });
    expect(h.state.upsertArgs?.opts).toEqual({
      onConflict: "user_id,business_id",
      ignoreDuplicates: true,
    });
  });

  it("reports not-ok when the write fails", async () => {
    h.state.upsertResult = { error: { message: "rls" } };
    const result = await hideBusiness({ userId: "u1", businessId: "b1" });
    expect(result.ok).toBe(false);
  });
});

describe("unhideBusiness", () => {
  it("deletes the row scoped to the user and business and reports ok", async () => {
    const result = await unhideBusiness({ userId: "u1", businessId: "b1" });
    expect(result.ok).toBe(true);
    expect(h.state.eqArgs).toContainEqual(["user_id", "u1"]);
    expect(h.state.eqArgs).toContainEqual(["business_id", "b1"]);
  });

  it("reports not-ok when the delete fails", async () => {
    h.state.deleteResult = { error: { message: "network" } };
    const result = await unhideBusiness({ userId: "u1", businessId: "b1" });
    expect(result.ok).toBe(false);
  });
});

describe("loadHiddenBusinessesWithNames", () => {
  it("returns an empty array for a signed-out user", async () => {
    expect(await loadHiddenBusinessesWithNames(null)).toEqual([]);
    expect(h.from).not.toHaveBeenCalled();
  });

  it("maps names whether the relation comes back as an object or an array", async () => {
    h.state.selectResult = {
      data: [
        { business_id: "b1", created_at: "2026-07-02T00:00:00Z", businesses: { name: "Cafe" } },
        { business_id: "b2", created_at: "2026-07-01T00:00:00Z", businesses: [{ name: "Bar" }] },
        { business_id: "b3", created_at: "2026-06-30T00:00:00Z", businesses: null },
      ],
      error: null,
    };
    const result = await loadHiddenBusinessesWithNames("u1");
    expect(result).toEqual([
      { businessId: "b1", name: "Cafe" },
      { businessId: "b2", name: "Bar" },
      { businessId: "b3", name: "" },
    ]);
  });

  it("fails open to an empty array on error", async () => {
    h.state.selectResult = { data: null, error: { message: "boom" } };
    expect(await loadHiddenBusinessesWithNames("u1")).toEqual([]);
  });
});
