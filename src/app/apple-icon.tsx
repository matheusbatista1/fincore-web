import { ImageResponse } from "next/og";
import { brandGlyph } from "@/presentation/lib/brand-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * iOS home-screen (apple-touch) icon: square and opaque, because iOS applies its own rounded mask.
 * iOS keeps the icon it fetched when the app was added; a changed icon needs the app added again.
 */
export default function AppleIcon() {
  return new ImageResponse(brandGlyph({ size: 180, square: true }), { ...size });
}
