import { cn } from "@/presentation/lib/cn";
import { resolveBankTheme } from "@/shared/theme/bank-themes";

/** Network brand mark, drawn small in the card's lower-right. */
function CardBrand({ flag }: { flag: string }) {
  if (flag === "mastercard") {
    return (
      <svg width="40" height="25" viewBox="0 0 40 25" role="img" aria-label="Mastercard">
        <circle cx="16" cy="12.5" r="9.5" fill="#EB001B" fillOpacity="0.95" />
        <circle cx="24" cy="12.5" r="9.5" fill="#F79E1B" fillOpacity="0.9" />
      </svg>
    );
  }
  if (flag === "visa") {
    return <span className="font-display text-base font-bold italic tracking-wide">VISA</span>;
  }
  if (flag === "elo") {
    return <span className="font-display text-sm font-bold tracking-tight">elo</span>;
  }
  if (flag === "amex") {
    return <span className="font-display text-xs font-bold uppercase tracking-widest">Amex</span>;
  }
  if (flag === "hipercard") {
    return <span className="font-display text-xs font-bold uppercase tracking-tight">Hiper</span>;
  }
  return null;
}

/** A bank-themed credit-card face (gradient + metallic sheen + guilloché + chip). */
export function CreditCardWidget({
  bank,
  product,
  flag,
  themeKey,
  maskedNumber,
  className,
}: {
  bank: string;
  product: string;
  flag: string;
  themeKey?: string | null;
  maskedNumber?: string;
  className?: string;
}) {
  const theme = resolveBankTheme(themeKey, bank);
  const flagStyle = theme.flagColor ? { color: theme.flagColor } : undefined;

  return (
    <div className={cn("cc-face font-ui", className)} style={{ background: theme.gradient }}>
      <div className="flex items-start justify-between gap-2">
        <span className="truncate text-[15px] font-bold tracking-tight">{bank}</span>
        <span
          className="shrink-0 text-[11px] font-bold uppercase tracking-[0.12em] opacity-90"
          style={flagStyle}
        >
          {product}
        </span>
      </div>

      <div className="cc-chip" />

      <div className="flex items-end justify-between gap-3">
        <span className="text-[15px] font-medium tracking-[0.14em] tabular-nums opacity-90">
          {maskedNumber || "•••• ••••"}
        </span>
        <span className="flex items-end opacity-95" style={flagStyle}>
          <CardBrand flag={flag} />
        </span>
      </div>
    </div>
  );
}
