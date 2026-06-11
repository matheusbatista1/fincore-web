import { ImageResponse } from "next/og";
import { brandGlyph } from "@/presentation/lib/brand-icon";

/** 512×512 PWA icon — full-bleed so it doubles as the `maskable` icon. */
export function GET() {
  return new ImageResponse(brandGlyph({ size: 512, radius: 0, fontScale: 0.5 }), {
    width: 512,
    height: 512,
  });
}
