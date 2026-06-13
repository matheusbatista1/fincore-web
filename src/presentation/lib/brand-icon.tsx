import type { ReactElement } from "react";

/**
 * The FinCore brand mark (the purple gradient tile with the white growing bars),
 * used to generate the favicon, the apple-touch icon and the PWA manifest icons
 * via `next/og` ImageResponse. Drawn with positioned <div>s rather than an SVG:
 * Satori (next/og) does not rasterize inline/`<img>` SVG reliably, so the bars
 * are plain flex children — this is what actually renders in the favicon.
 */
export function brandGlyph({
  size,
  bleed = false,
}: {
  size: number;
  /** Full-bleed (square corners) for the 512 maskable icon; rounded otherwise. */
  bleed?: boolean;
}): ReactElement {
  const barWidth = Math.round(size * 0.13);
  const barRadius = Math.round(size * 0.07);
  const gap = Math.round(size * 0.05);
  const bottom = Math.round(size * 0.27);
  const h1 = Math.round(size * 0.22);
  const h2 = Math.round(size * 0.34);
  const h3 = Math.round(size * 0.48);

  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        alignItems: "flex-end",
        justifyContent: "center",
        gap,
        paddingBottom: bottom,
        background: "linear-gradient(135deg, #9B79FF 0%, #7C5CFF 55%, #5733D4 100%)",
        borderRadius: bleed ? 0 : Math.round(size * 0.22),
      }}
    >
      <div
        style={{ width: barWidth, height: h1, borderRadius: barRadius, background: "rgba(255,255,255,0.6)" }}
      />
      <div
        style={{ width: barWidth, height: h2, borderRadius: barRadius, background: "rgba(255,255,255,0.82)" }}
      />
      <div style={{ width: barWidth, height: h3, borderRadius: barRadius, background: "#ffffff" }} />
    </div>
  );
}
