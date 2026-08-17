import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
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
      <body>{children}</body>
    </html>
  );
}
