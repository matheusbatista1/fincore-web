import {
  Car,
  Gamepad2,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  type LucideIcon,
  PiggyBank,
  Plane,
  Receipt,
  ShoppingBag,
  Sparkles,
  Tag,
  UtensilsCrossed,
} from "lucide-react";

/** Curated lucide icons selectable for a category (keyed by their lucide name). */
const REGISTRY: Record<string, LucideIcon> = {
  "utensils-crossed": UtensilsCrossed,
  car: Car,
  house: House,
  "shopping-bag": ShoppingBag,
  "heart-pulse": HeartPulse,
  "graduation-cap": GraduationCap,
  "gamepad-2": Gamepad2,
  plane: Plane,
  receipt: Receipt,
  gift: Gift,
  "piggy-bank": PiggyBank,
  sparkles: Sparkles,
  tag: Tag,
};

/** The icon names offered in the category picker, in display order. */
export const CATEGORY_ICON_NAMES = Object.keys(REGISTRY);

export const DEFAULT_CATEGORY_ICON = "tag";

/** Render a category's lucide icon by name, falling back to a generic tag. */
export function CategoryIcon({ name, size = 16 }: { name: string; size?: number }) {
  const Icon = REGISTRY[name] ?? Tag;
  return <Icon size={size} />;
}
