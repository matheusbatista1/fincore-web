import { ImageResponse } from "next/og";
import { brandGlyph } from "@/presentation/lib/brand-icon";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** Browser favicon. */
export default function Icon() {
  return new ImageResponse(brandGlyph({ size: 32 }), { ...size });
}
