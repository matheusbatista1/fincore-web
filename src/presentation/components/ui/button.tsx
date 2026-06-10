import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/presentation/lib/cn";

const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-pill font-semibold transition disabled:pointer-events-none disabled:opacity-60",
  {
    variants: {
      variant: {
        primary: "bg-purple-500 text-on-purple shadow-glow hover:bg-purple-600",
        ghost: "border border-line bg-surface-2 text-text-hi hover:bg-surface-3",
        quiet: "text-text-mid hover:bg-surface-2 hover:text-text-hi",
        danger: "bg-rose-soft text-rose-500 hover:bg-rose-500/20",
      },
      size: {
        sm: "h-9 px-4 text-sm",
        md: "h-11 px-5 text-sm",
        icon: "size-10",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {}

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(button({ variant, size }), className)} {...props} />;
}
