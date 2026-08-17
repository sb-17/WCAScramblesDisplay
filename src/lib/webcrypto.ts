/**
 * WebCrypto is restricted to secure contexts: HTTPS, or localhost as a development
 * exemption. Over plain HTTP on a LAN address -- which is exactly how a tablet reaches a
 * dev server -- crypto.subtle is undefined and nothing in this app can work.
 *
 * Worth detecting explicitly, because the failure is otherwise a confusing TypeError deep
 * inside a key operation rather than an obvious "this page needs HTTPS".
 */
export function webCryptoAvailable(): boolean {
  return typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined";
}

/** localStorage throws rather than returning null in some private-browsing modes. */
export function safeLocalStorage(): Storage | null {
  try {
    const probe = "__wcasd_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}
