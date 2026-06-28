export const SECURE_STORE_VALUE_CHUNK_SIZE = 1800;
export const SECURE_STORE_MAX_CHUNKS = 64;

const CHUNK_COUNT_SUFFIX = ".secure-store-chunks.v1";
const CHUNK_KEY_SUFFIX = ".secure-store-chunk.v1.";

export type SecureStoreLike = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
};

function chunkCountKey(key: string) {
  return `${key}${CHUNK_COUNT_SUFFIX}`;
}

function chunkKey(key: string, index: number) {
  return `${key}${CHUNK_KEY_SUFFIX}${index}`;
}

function parseChunkCount(raw: string | null): number | null {
  if (!raw) return null;
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 1 || count > SECURE_STORE_MAX_CHUNKS) return null;
  return count;
}

function splitValue(value: string): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += SECURE_STORE_VALUE_CHUNK_SIZE) {
    chunks.push(value.slice(index, index + SECURE_STORE_VALUE_CHUNK_SIZE));
  }
  return chunks;
}

async function removeChunks(store: SecureStoreLike, key: string, count: number | null) {
  const chunkCount = count ?? 0;
  await Promise.all([
    ...Array.from({ length: chunkCount }, (_, index) => store.deleteItemAsync(chunkKey(key, index))),
    store.deleteItemAsync(chunkCountKey(key)),
  ]);
}

export async function getNativeSessionItem(store: SecureStoreLike, key: string): Promise<string | null> {
  const count = parseChunkCount(await store.getItemAsync(chunkCountKey(key)));
  if (!count) {
    return store.getItemAsync(key);
  }

  const chunks = await Promise.all(Array.from({ length: count }, (_, index) => store.getItemAsync(chunkKey(key, index))));
  if (chunks.some((chunk) => chunk == null)) {
    return null;
  }
  return chunks.join("");
}

export async function setNativeSessionItem(store: SecureStoreLike, key: string, value: string): Promise<void> {
  const previousCount = parseChunkCount(await store.getItemAsync(chunkCountKey(key)));
  if (value.length <= SECURE_STORE_VALUE_CHUNK_SIZE) {
    await store.setItemAsync(key, value);
    await removeChunks(store, key, previousCount);
    return;
  }

  const chunks = splitValue(value);
  if (chunks.length > SECURE_STORE_MAX_CHUNKS) {
    throw new Error("Supabase auth session is too large to persist securely.");
  }

  await Promise.all(chunks.map((chunk, index) => store.setItemAsync(chunkKey(key, index), chunk)));
  if (previousCount && previousCount > chunks.length) {
    await Promise.all(
      Array.from({ length: previousCount - chunks.length }, (_, offset) =>
        store.deleteItemAsync(chunkKey(key, chunks.length + offset)),
      ),
    );
  }
  await store.deleteItemAsync(key);
  await store.setItemAsync(chunkCountKey(key), String(chunks.length));
}

export async function removeNativeSessionItem(store: SecureStoreLike, key: string): Promise<void> {
  const count = parseChunkCount(await store.getItemAsync(chunkCountKey(key)));
  await store.deleteItemAsync(key);
  await removeChunks(store, key, count);
}
