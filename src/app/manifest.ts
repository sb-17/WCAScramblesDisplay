import type { MetadataRoute } from "next";

/**
 * Makes the app installable to a home screen, which matters most for the scrambling-area
 * tablet: standalone display means no address bar, so there is nothing to type a different
 * URL into once a display is running.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WCA Scrambles Display",
    short_name: "Scrambles",
    description: "Show scramble sets on the scrambling-area display without typing a passcode.",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0f1114",
    theme_color: "#0f1114",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
