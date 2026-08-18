import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { appVersion } from "@/lib/version";
import "./globals.css";

export const metadata: Metadata = {
  title: "WCA Scrambles Display",
  description: "Show scramble sets on the scrambling-area display without typing passcodes.",
  // iOS needs this as well as the manifest to run without Safari's chrome.
  appleWebApp: { capable: true, title: "Scrambles", statusBarStyle: "black" },
};

export const viewport: Viewport = {
  themeColor: "#0f1114",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        {/*
          Every page including the display, so the build a tablet is running can be read off
          it without touching anything. Inert and out of the way: no link, since navigating
          away is exactly what a display must not offer.
        */}
        <div className="version" aria-hidden="true">
          {appVersion()}
        </div>
      </body>
    </html>
  );
}
