/**
 * Every scramble is encrypted here, in the browser, before it is uploaded. The server
 * only ever stores ciphertext and wrapped keys, so it cannot read a scramble even if it
 * wanted to.
 *
 * Key hierarchy:
 *
 *   identity keypair (ECDH P-256, one per Delegate, private half never leaves the device)
 *     wraps -> competition key (AES-256-GCM, one per competition)
 *       wraps -> set key (AES-256-GCM, one per scramble set)
 *         encrypts -> the TNoodle PDF concatenated with its own passcode
 *
 * Wrapping is ECDH-ES with an ephemeral sender key, so a key can be wrapped to a
 * recipient's public key alone -- no prior contact and no sender identity needed. That is
 * what lets a Delegate hand a key to a display device it has never met, and to a
 * co-delegate who has only ever published a public key.
 *
 * Runs unchanged in the browser and in Node, which is what makes it testable.
 */

/**
 * WebCrypto's BufferSource requires a view backed by a real ArrayBuffer, whereas a bare
 * Uint8Array widens to ArrayBufferLike and so could be backed by a SharedArrayBuffer.
 * Being explicit keeps every signature here assignable without casts.
 */
type Bytes = Uint8Array<ArrayBuffer>;

const CURVE = { name: "ECDH", namedCurve: "P-256" } as const;
const HKDF_INFO = "wcasd-key-wrap-v1";

/** Raw P-256 public key is 0x04 ‖ x ‖ y. */
const EPK_BYTES = 65;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/** OWASP's floor for PBKDF2-HMAC-SHA256 at the time of writing. */
const PBKDF2_ITERATIONS = 600_000;

function concat(...parts: Bytes[]): Bytes {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function deriveWrappingKey(shared: ArrayBuffer, salt: Bytes): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode(HKDF_INFO) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// -- identity ---------------------------------------------------------------

export async function generateIdentity(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(CURVE, true, ["deriveBits"]);
}

export async function exportPublicKey(key: CryptoKey): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.exportKey("raw", key));
}

export async function importPublicKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, CURVE, false, []);
}

// -- wrapping a secret to somebody's public key ------------------------------

/**
 * Layout: ephemeral public key ‖ HKDF salt ‖ GCM iv ‖ ciphertext.
 * Fixed-width prefix, so it unpacks by offset and stores cleanly in a bytea column.
 */
export async function wrapToPublicKey(
  secret: Bytes,
  recipient: CryptoKey,
): Promise<Bytes> {
  const ephemeral = await crypto.subtle.generateKey(CURVE, false, ["deriveBits"]);
  const shared = await crypto.subtle.deriveBits(
    { name: "ECDH", public: recipient },
    ephemeral.privateKey,
    256,
  );

  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveWrappingKey(shared, salt);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, secret),
  );

  return concat(await exportPublicKey(ephemeral.publicKey), salt, iv, ciphertext);
}

export async function unwrapWithPrivateKey(
  blob: Bytes,
  privateKey: CryptoKey,
): Promise<Bytes> {
  if (blob.length <= EPK_BYTES + SALT_BYTES + IV_BYTES) {
    throw new Error("Wrapped key is truncated");
  }

  const ephemeral = await importPublicKey(blob.subarray(0, EPK_BYTES));
  const salt = blob.subarray(EPK_BYTES, EPK_BYTES + SALT_BYTES);
  const iv = blob.subarray(EPK_BYTES + SALT_BYTES, EPK_BYTES + SALT_BYTES + IV_BYTES);
  const ciphertext = blob.subarray(EPK_BYTES + SALT_BYTES + IV_BYTES);

  const shared = await crypto.subtle.deriveBits(
    { name: "ECDH", public: ephemeral },
    privateKey,
    256,
  );
  const key = await deriveWrappingKey(shared, salt);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext));
}

// -- bulk data --------------------------------------------------------------

export async function generateDataKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

export async function exportDataKey(key: CryptoKey): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.exportKey("raw", key));
}

export async function importDataKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, [
    "encrypt",
    "decrypt",
  ]);
}

/** Layout: iv ‖ ciphertext. */
export async function encryptData(key: CryptoKey, plaintext: Bytes): Promise<Bytes> {
  const iv = randomBytes(IV_BYTES);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
  );
  return concat(iv, ciphertext);
}

export async function decryptData(key: CryptoKey, blob: Bytes): Promise<Bytes> {
  if (blob.length <= IV_BYTES) throw new Error("Encrypted blob is truncated");
  const iv = blob.subarray(0, IV_BYTES);
  const ciphertext = blob.subarray(IV_BYTES);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext));
}

// -- recovery ---------------------------------------------------------------

/**
 * Backs the identity private key up under a recovery phrase, so clearing browser data
 * does not permanently lock a Delegate out of every competition they have uploaded.
 * The server stores only this blob and never sees the phrase, so it stays zero-knowledge.
 */
/** Crockford base32: exactly 32 characters, and it omits I, L, O and U. */
const RECOVERY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Generated rather than user-chosen: this protects real scrambles, and people pick weak
 * passphrases. Five groups of four is 100 bits. 32 divides 256 exactly, so indexing a
 * random byte into the alphabet introduces no modulo bias.
 */
export function generateRecoveryPhrase(): string {
  const chars = Array.from(randomBytes(20), (byte) =>
    RECOVERY_ALPHABET.charAt(byte % RECOVERY_ALPHABET.length),
  );
  return [0, 4, 8, 12, 16].map((start) => chars.slice(start, start + 4).join("")).join("-");
}

/**
 * Phrases get written on paper and typed back in, so be forgiving: fold case, drop the
 * grouping dashes, and map the characters Crockford deliberately excluded onto the digits
 * they get mistaken for.
 */
export function normaliseRecoveryPhrase(phrase: string): string {
  return phrase
    .toUpperCase()
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/[^0-9A-Z]/g, "");
}

export async function deriveRecoveryKey(phrase: string, salt: Bytes): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(normaliseRecoveryPhrase(phrase)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function wrapPrivateKeyForRecovery(
  privateKey: CryptoKey,
  phrase: string,
): Promise<{ salt: Bytes; blob: Bytes }> {
  const salt = randomBytes(SALT_BYTES);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", privateKey));
  const blob = await encryptData(await deriveRecoveryKey(phrase, salt), pkcs8);
  return { salt, blob };
}

export async function recoverPrivateKey(
  blob: Bytes,
  salt: Bytes,
  phrase: string,
): Promise<CryptoKey> {
  const pkcs8 = await decryptData(await deriveRecoveryKey(phrase, salt), blob);
  return crypto.subtle.importKey("pkcs8", pkcs8, CURVE, true, ["deriveBits"]);
}
