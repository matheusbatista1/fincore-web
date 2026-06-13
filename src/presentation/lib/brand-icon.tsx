import type { ReactElement } from "react";

/**
 * The FinCore brand mark (the purple gradient tile with the white growing bars
 * and the up-trend tick — the same glyph as `LogoMark`), used to generate the
 * favicon, the apple-touch icon and the PWA manifest icons via `next/og`
 * ImageResponse. Kept framework-free so every icon route shares it.
 *
 * The glyph is composed as: a gradient tile (the background) + the white bars
 * drawn as an inline SVG overlay (rasterized by Satori), so it matches
 * `src/presentation/components/ui/logo-mark.tsx` 1:1.
 */

/** The white bars + up-trend tick, framed tight and square so it centers cleanly. */
function barsSvg(px: number): string {
  return [
    `<svg width="${px}" height="${px}" viewBox="6 4 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">`,
    `<rect x="11" y="22" width="5.2" height="8" rx="2.6" fill="#fff" fill-opacity="0.55"/>`,
    `<rect x="17.4" y="16" width="5.2" height="14" rx="2.6" fill="#fff" fill-opacity="0.78"/>`,
    `<rect x="23.8" y="10" width="5.2" height="20" rx="2.6" fill="#fff"/>`,
    `<path d="M25 9.4 L26.4 6.2 L29.6 7.6" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    `</svg>`,
  ].join("");
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export function brandGlyph({
  size,
  bleed = false,
}: {
  size: number;
  /** Full-bleed (square corners) for the 512 maskable icon; rounded otherwise. */
  bleed?: boolean;
}): ReactElement {
  // Smaller mark inside a safe zone for the maskable icon; larger for the rest.
  const markSize = Math.round(size * (bleed ? 0.62 : 0.84));
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #9B79FF 0%, #7C5CFF 55%, #5733D4 100%)",
        borderRadius: bleed ? 0 : Math.round(size * 0.22),
      }}
    >
      {/* biome-ignore lint/performance/noImgElement: next/og (Satori) renders <img>, not next/image. */}
      <img width={markSize} height={markSize} src={svgDataUri(barsSvg(markSize))} alt="" />
    </div>
  );
}
