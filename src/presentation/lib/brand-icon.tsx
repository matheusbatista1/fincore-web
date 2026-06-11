import type { ReactElement } from "react";

/**
 * The FinCore brand glyph (a purple gradient square with a white "F"), used to
 * generate the favicon, the apple-touch icon and the PWA manifest icons via
 * `next/og` ImageResponse. Kept framework-free so every icon route shares it.
 */
export function brandGlyph({
  size,
  radius = 0.22,
  fontScale = 0.6,
}: {
  size: number;
  radius?: number;
  fontScale?: number;
}): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #9B79FF, #6A45F0)",
        color: "#ffffff",
        fontSize: Math.round(size * fontScale),
        fontWeight: 700,
        fontFamily: "sans-serif",
        borderRadius: Math.round(size * radius),
      }}
    >
      F
    </div>
  );
}
