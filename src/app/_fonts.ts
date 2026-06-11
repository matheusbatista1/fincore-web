import localFont from "next/font/local";

/** Body / UI typeface (Satoshi), self-hosted to drop the render-blocking Fontshare @import. */
export const satoshi = localFont({
  src: [
    { path: "./fonts/Satoshi-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Satoshi-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Satoshi-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-satoshi",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "sans-serif"],
});

/** Display typeface (Clash Display) for headings and big numbers. */
export const clashDisplay = localFont({
  src: [
    { path: "./fonts/ClashDisplay-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ClashDisplay-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/ClashDisplay-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-clash",
  display: "swap",
  fallback: ["Satoshi", "system-ui", "sans-serif"],
});
