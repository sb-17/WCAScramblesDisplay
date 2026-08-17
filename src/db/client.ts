import { neon } from "@neondatabase/serverless";

type Query = ReturnType<typeof neon>;

let cached: Query | null = null;

/**
 * Lazy so that importing this module does not require DATABASE_URL -- pages that never
 * touch the database, and the production build itself, should not fail without it.
 */
export function db(): Query {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    cached = neon(url);
  }
  return cached;
}

/**
 * node-postgres hands bytea back as a Buffer, and wants a Buffer going in. Both helpers
 * exist so the rest of the app can deal in plain Uint8Arrays and never think about it.
 */
export function toBytea(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function fromBytea(value: unknown): Uint8Array<ArrayBuffer> {
  if (value instanceof Uint8Array) {
    const copy = new Uint8Array(value.byteLength);
    copy.set(value);
    return copy;
  }
  throw new Error(`Expected bytea, received ${typeof value}`);
}
