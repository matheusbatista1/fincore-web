import type { ReactElement } from "react";

/**
 * The FinCore brand mark — the exact `LogoMark` glyph (purple gradient tile,
 * subtle shine, white growing bars + up-trend tick) rendered as an inline-SVG
 * `<img>`, used to generate the favicon, apple-touch icon and PWA icons via
 * `next/og`. Keeping the original viewBox keeps the tick as crisp as the logo.
 */
function logoSvg(px: number): string {
  return [
    `<svg width="${px}" height="${px}" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">`,
    `<defs>`,
    `<linearGradient id="fcg" x1="6" y1="4" x2="34" y2="38" gradientUnits="userSpaceOnUse">`,
    `<stop stop-color="#9B79FF"/><stop offset="0.55" stop-color="#7C5CFF"/><stop offset="1" stop-color="#5733D4"/>`,
    `</linearGradient>`,
    `<linearGradient id="fcs" x1="8" y1="6" x2="20" y2="22" gradientUnits="userSpaceOnUse">`,
    `<stop stop-color="#fff" stop-opacity="0.35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>`,
    `</linearGradient>`,
    `</defs>`,
    `<rect x="2" y="2" width="36" height="36" rx="11" fill="url(#fcg)"/>`,
    `<rect x="2" y="2" width="36" height="18" rx="11" fill="url(#fcs)"/>`,
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
  // The mark's own viewBox is already a rounded tile, so non-bleed renders it
  // edge to edge. The maskable icon needs a full-bleed gradient behind a smaller
  // mark (safe zone), so we paint the tile gradient on a wrapper div.
  if (!bleed) {
    return (
      <div style={{ display: "flex", width: "100%", height: "100%" }}>
        {/* biome-ignore lint/performance/noImgElement: next/og (Satori) renders <img>, not next/image. */}
        <img width={size} height={size} src={svgDataUri(logoSvg(size))} alt="" />
      </div>
    );
  }
  const markSize = Math.round(size * 0.66);
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(150deg, #9B79FF 0%, #7C5CFF 55%, #5733D4 100%)",
      }}
    >
      {/* biome-ignore lint/performance/noImgElement: next/og (Satori) renders <img>, not next/image. */}
      <img width={markSize} height={markSize} src={svgDataUri(logoSvg(markSize))} alt="" />
    </div>
  );
}
