/**
 * The identity private key lives in IndexedDB and never leaves the browser. CryptoKey
 * objects are structured-cloneable, so the key is stored as a key object rather than as
 * raw bytes -- there is no point in it sitting in storage in an exported form.
 *
 * Keyed by WCA user id so more than one Delegate can use the same laptop.
 */
const DB_NAME = "wcasd";
const DB_VERSION = 1;
const STORE = "identity";

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
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadIdentity(wcaUserId: number): Promise<CryptoKeyPair | null> {
  const idb = await open();
  try {
    const stored = await request(
      idb.transaction(STORE, "readonly").objectStore(STORE).get(wcaUserId),
    );
    return (stored as CryptoKeyPair | undefined) ?? null;
  } finally {
    idb.close();
  }
}

export async function saveIdentity(wcaUserId: number, keys: CryptoKeyPair): Promise<void> {
  const idb = await open();
  try {
    const tx = idb.transaction(STORE, "readwrite");
    await request(tx.objectStore(STORE).put(keys, wcaUserId));
  } finally {
    idb.close();
  }
}

/**
 * Browsers can evict IndexedDB under storage pressure, which would mean falling back to
 * the recovery phrase mid-competition. Asking for persistence makes that far less likely.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}
