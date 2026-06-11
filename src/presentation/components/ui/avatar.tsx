import type { CSSProperties } from "react";

/** Initials avatar — ported 1:1 from the prototype (ui.jsx Avatar / .ava-circle). */
export function Avatar({
  name,
  color,
  size = 36,
  radius,
}: {
  name: string;
  color?: string;
  size?: number;
  radius?: number;
}) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
  const style: CSSProperties = {
    width: size,
    height: size,
    fontSize: size * 0.38,
    borderRadius: radius != null ? radius : "50%",
    background: color || "linear-gradient(135deg, var(--purple-400), var(--purple-700))",
  };
  return (
    <span className="ava-circle" style={style}>
      {initials}
    </span>
  );
}
