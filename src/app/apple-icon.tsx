import { ImageResponse } from "next/og";
import { brandGlyph } from "@/presentation/lib/brand-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** iOS home-screen (apple-touch) icon. */
export default function AppleIcon() {
  return new ImageResponse(brandGlyph({ size: 180, radius: 0.22, fontScale: 0.6 }), { ...size });
}
