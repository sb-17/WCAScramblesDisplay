import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,

  /**
   * Development only. A tablet reaching this dev server over the LAN is a different origin
   * from Next's dev resources, which are blocked by default -- the scripts never load, the
   * page never hydrates, and every control on it silently does nothing.
   *
   * Update this if the machine's LAN address changes; the dev server prints the address it
   * is refusing.
   */
  allowedDevOrigins: ["192.168.68.59"],
};

export default config;
