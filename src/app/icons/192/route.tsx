import { ImageResponse } from "next/og";
import { brandGlyph } from "@/presentation/lib/brand-icon";

/** 192×192 PWA icon (manifest `any`). */
export function GET() {
  return new ImageResponse(brandGlyph({ size: 192 }), {
    width: 192,
    height: 192,
  });
}
