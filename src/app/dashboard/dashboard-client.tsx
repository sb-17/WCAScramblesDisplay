"use client";

import { useEffect, useState } from "react";
import { webCryptoAvailable } from "@/lib/webcrypto";
import InsecureContext from "../insecure-context";
import Competitions from "./competitions";
import IdentitySetup from "./identity-setup";

/**
 * Competitions only appear once an identity key is available, because every competition
 * needs a key wrapped to it at creation time. Gating on that avoids a half-usable screen.
 */
export default function DashboardClient({ wcaUserId }: { wcaUserId: number }) {
  const [keys, setKeys] = useState<CryptoKeyPair | null>(null);
  const [secure, setSecure] = useState(true);

  useEffect(() => setSecure(webCryptoAvailable()), []);

  if (!secure) return <InsecureContext />;

  return (
    <div className="stack" style={{ gap: "1.5rem" }}>
      <IdentitySetup wcaUserId={wcaUserId} onReady={setKeys} />
      {keys ? <Competitions keys={keys} /> : null}
    </div>
  );
}
