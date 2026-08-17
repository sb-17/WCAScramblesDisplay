"use client";

import { useEffect, useState } from "react";
import { readToken } from "@/lib/display-store";

/**
 * Pairing already signs a Delegate out of this browser, so reaching a Delegate page on a
 * paired display means somebody signed in again afterwards. That is a deliberate act, not
 * an accident, so this warns and offers one tap out rather than blocking.
 *
 * Deliberately not a hard block: refusing Delegate pages whenever a display is paired
 * would lock somebody out of their own dashboard with no way back if the tablet is the
 * only device they have.
 */
export default function DisplayModeBanner() {
  const [isDisplay, setIsDisplay] = useState(false);

  useEffect(() => setIsDisplay(readToken() !== null), []);

  if (!isDisplay) return null;

  return (
    <div className="card stack" style={{ borderColor: "var(--warn)" }}>
      <h2>This device is a display</h2>
      <p className="muted">
        Anyone in the scrambling area who picks it up can see whatever is open here. Sign
        out before leaving it.
      </p>
      <form action="/api/auth/logout" method="post">
        <button className="button button--danger" type="submit">
          Sign out
        </button>
      </form>
    </div>
  );
}
