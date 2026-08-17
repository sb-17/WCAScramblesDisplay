/**
 * Storage for the display device: its identity, its session token, and every scramble set
 * cached as ciphertext.
 *
 * Caching the whole competition up front is deliberate. Venue networks are unreliable, and
 * once the sets are local the network only has to carry a few hundred bytes saying which
 * one to show. The cache is useless on its own -- it is ciphertext, and the key arrives
 * only when a Delegate pushes.
 */
const DB_NAME = "wcasd-display";
const DB_VERSION = 1;
const KEYS = "keys";
const SETS = "sets";

import { safeLocalStorage } from "./webcrypto";

const TOKEN_KEY = "wcasd-display-token";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(KEYS)) idb.createObjectStore(KEYS);
      if (!idb.objectStoreNames.contains(SETS)) idb.createObjectStore(SETS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const idb = await open();
  try {
    return await request(run(idb.transaction(store, mode).objectStore(store)));
  } finally {
    idb.close();
  }
}

export function readToken(): string | null {
  return safeLocalStorage()?.getItem(TOKEN_KEY) ?? null;
}

export function writeToken(token: string): void {
  safeLocalStorage()?.setItem(TOKEN_KEY, token);
}

export function forgetToken(): void {
  safeLocalStorage()?.removeItem(TOKEN_KEY);
}

export async function loadDeviceKeys(): Promise<CryptoKeyPair | null> {
  const stored = await withStore<unknown>(KEYS, "readonly", (store) => store.get("identity"));
  return (stored as CryptoKeyPair | undefined) ?? null;
}

export async function saveDeviceKeys(keys: CryptoKeyPair): Promise<void> {
  await withStore(KEYS, "readwrite", (store) => store.put(keys, "identity"));
}

export async function cachedSet(setId: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const stored = await withStore<unknown>(SETS, "readonly", (store) => store.get(setId));
  return (stored as Uint8Array<ArrayBuffer> | undefined) ?? null;
}

export async function cacheSet(setId: string, ciphertext: Uint8Array): Promise<void> {
  await withStore(SETS, "readwrite", (store) => store.put(ciphertext, setId));
}

export async function cachedSetIds(): Promise<string[]> {
  const keys = await withStore<IDBValidKey[]>(SETS, "readonly", (store) => store.getAllKeys());
  return keys.map(String);
}

/** Wiped when a device is unpaired, so nothing is left behind on a shared tablet. */
export async function clearCache(): Promise<void> {
  await withStore(SETS, "readwrite", (store) => store.clear());
  await withStore(KEYS, "readwrite", (store) => store.clear());
}
