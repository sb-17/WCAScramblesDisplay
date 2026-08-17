/**
 * What actually gets encrypted for a scramble set: the untouched TNoodle PDF together with
 * its own passcode, so the display device receives both in one sealed blob.
 *
 * Layout is a two-byte big-endian passcode length, the passcode, then the PDF. A length
 * prefix rather than a separator because PDF bytes are arbitrary -- any delimiter could
 * legitimately occur inside one.
 */
const LENGTH_BYTES = 2;

export function packSet(pdf: Uint8Array, passcode: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(passcode);
  if (encoded.length > 0xffff) throw new Error("Passcode is implausibly long");

  const out = new Uint8Array(LENGTH_BYTES + encoded.length + pdf.length);
  new DataView(out.buffer).setUint16(0, encoded.length);
  out.set(encoded, LENGTH_BYTES);
  out.set(pdf, LENGTH_BYTES + encoded.length);
  return out;
}

export function unpackSet(bytes: Uint8Array): {
  pdf: Uint8Array<ArrayBuffer>;
  passcode: string;
} {
  if (bytes.length < LENGTH_BYTES) throw new Error("Payload is truncated");

  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(0);
  const pdfStart = LENGTH_BYTES + length;
  if (bytes.length < pdfStart) throw new Error("Payload is truncated");

  const pdf = new Uint8Array(bytes.length - pdfStart);
  pdf.set(bytes.subarray(pdfStart));

  return {
    pdf,
    passcode: new TextDecoder().decode(bytes.subarray(LENGTH_BYTES, pdfStart)),
  };
}
