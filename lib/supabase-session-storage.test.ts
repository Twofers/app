import { describe, expect, it } from "vitest";

import {
  getNativeSessionItem,
  removeNativeSessionItem,
  SECURE_STORE_VALUE_CHUNK_SIZE,
  setNativeSessionItem,
  type SecureStoreLike,
} from "./supabase-session-storage";

function createMemoryStore() {
  const data = new Map<string, string>();
  const setValues: string[] = [];
  const store: SecureStoreLike = {
    async getItemAsync(key) {
      return data.get(key) ?? null;
    },
    async setItemAsync(key, value) {
      data.set(key, value);
      setValues.push(value);
    },
    async deleteItemAsync(key) {
      data.delete(key);
    },
  };
  return { data, setValues, store };
}

describe("native Supabase session storage", () => {
  it("stores small sessions directly", async () => {
    const { data, store } = createMemoryStore();

    await setNativeSessionItem(store, "session", "small-value");

    expect(await getNativeSessionItem(store, "session")).toBe("small-value");
    expect([...data.keys()]).toEqual(["session"]);
  });

  it("chunks large sessions before writing to SecureStore", async () => {
    const { data, setValues, store } = createMemoryStore();
    const largeValue = "x".repeat(SECURE_STORE_VALUE_CHUNK_SIZE * 2 + 37);

    await setNativeSessionItem(store, "session", largeValue);

    expect(data.has("session")).toBe(false);
    expect(await getNativeSessionItem(store, "session")).toBe(largeValue);
    expect(setValues.every((value) => value.length <= SECURE_STORE_VALUE_CHUNK_SIZE)).toBe(true);
  });

  it("removes chunked sessions", async () => {
    const { data, store } = createMemoryStore();
    await setNativeSessionItem(store, "session", "x".repeat(SECURE_STORE_VALUE_CHUNK_SIZE + 1));

    await removeNativeSessionItem(store, "session");

    expect(await getNativeSessionItem(store, "session")).toBeNull();
    expect([...data.keys()]).toEqual([]);
  });

  it("cleans stale chunks when a large session becomes small", async () => {
    const { data, store } = createMemoryStore();
    await setNativeSessionItem(store, "session", "x".repeat(SECURE_STORE_VALUE_CHUNK_SIZE + 1));

    await setNativeSessionItem(store, "session", "small-again");

    expect(await getNativeSessionItem(store, "session")).toBe("small-again");
    expect([...data.keys()]).toEqual(["session"]);
  });

  it("does not reconstruct incomplete chunk sets", async () => {
    const { data, store } = createMemoryStore();
    await setNativeSessionItem(store, "session", "x".repeat(SECURE_STORE_VALUE_CHUNK_SIZE + 1));
    const firstChunkKey = [...data.keys()].find((key) => key.includes(".secure-store-chunk.v1.0"));
    expect(firstChunkKey).toBeTruthy();
    data.delete(firstChunkKey!);

    expect(await getNativeSessionItem(store, "session")).toBeNull();
  });
});
