"use client";

/**
 * Shown in place of anything that needs WebCrypto when the page is not a secure context.
 * Without this the failure surfaces as an unrelated error much later.
 */
export default function InsecureContext() {
  return (
    <div className="card stack">
      <h2>This page needs HTTPS</h2>
      <p className="muted">
        Browsers only allow encryption on secure pages. Open this over https, or on the same
        machine at localhost.
      </p>
      <p className="muted mono" style={{ fontSize: "0.875rem", wordBreak: "break-all" }}>
        {typeof window === "undefined" ? "" : window.location.origin}
      </p>
    </div>
  );
}
