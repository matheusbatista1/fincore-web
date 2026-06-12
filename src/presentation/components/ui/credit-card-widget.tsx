import { resolveThemeKey } from "@/shared/theme/bank-themes";

/** Network brand marks — ported 1:1 from the prototype (ui.jsx CardBrand). */
function CardBrand({ flag, size = 30 }: { flag: string; size?: number }) {
  const f = (flag || "").toLowerCase();
  if (f === "visa") {
    return (
      <svg height={size * 0.62} viewBox="0 0 48 16" fill="none" role="img" aria-label="Visa">
        <path d="M21.3 15.5h-3.4L20 .6h3.4l-2.1 14.9z" fill="#fff" />
        <path
          d="M33.6.9C32.9.6 31.8.3 30.4.3c-3.5 0-6 1.8-6 4.4 0 1.9 1.8 3 3.2 3.6 1.4.6 1.9 1 1.9 1.6 0 .9-1.1 1.3-2.1 1.3-1.4 0-2.2-.2-3.3-.7l-.5-.2-.5 3c.8.3 2.3.6 3.8.7 3.7 0 6.1-1.8 6.2-4.5 0-1.5-.9-2.7-3-3.6-1.3-.6-2.1-1-2.1-1.6 0-.5.6-1.1 2-1.1 1.1 0 2 .2 2.6.5l.4.1.5-2.9z"
          fill="#fff"
        />
        <path
          d="M38.2.6h-2.6c-.8 0-1.4.2-1.8 1.1l-5.1 13.8h3.7l.7-2.1h4.5l.4 2.1h3.3L38.2.6zm-4.1 9.6l1.4-3.9.8 3.9h-2.2z"
          fill="#fff"
        />
        <path d="M16.7.6L13.3 11l-.4-1.9C12.3 6.9 10.3 4.5 8 3.3l3.1 12.1h3.7L20.4.6h-3.7z" fill="#fff" />
        <path d="M10.6.6H4.9l-.1.4c4.4 1.2 7.4 4 8.6 7.4L12.2 1.7c-.2-.9-.8-1.1-1.6-1.1z" fill="#FBB03B" />
      </svg>
    );
  }
  if (f === "elo") {
    return (
      <svg height={size * 0.7} viewBox="0 0 40 40" fill="none" role="img" aria-label="Elo">
        <circle cx="20" cy="20" r="20" fill="#000" />
        <path
          d="M13 16.5a5.5 5.5 0 0 1 7.8-1.2l1.8-2.6A8.8 8.8 0 0 0 9.4 21l3.2-.9a5.5 5.5 0 0 1 .4-3.6z"
          fill="#FFF100"
        />
        <path d="M27 13.2l-1.8 2.6a5.5 5.5 0 0 1 0 8.4l1.8 2.6a8.8 8.8 0 0 0 0-13.6z" fill="#00A4E0" />
        <path
          d="M20.8 25.7a5.5 5.5 0 0 1-7.8-1.2l-3.2.9a8.8 8.8 0 0 0 13.2 3.5l-1.8-2.6c-.1 0-.3-.4-.4-.6z"
          fill="#EF4123"
        />
      </svg>
    );
  }
  if (f === "amex" || f === "hipercard") {
    // No bespoke mark in the prototype — show the brand word instead of a wrong logo.
    return (
      <span
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "#fff",
          opacity: 0.9,
        }}
      >
        {f === "amex" ? "AMEX" : "Hipercard"}
      </span>
    );
  }
  if (f === "other") return null;
  return (
    <svg height={size * 0.72} viewBox="0 0 48 30" fill="none" role="img" aria-label="Mastercard">
      <circle cx="18" cy="15" r="13" fill="#EB001B" />
      <circle cx="30" cy="15" r="13" fill="#F79E1B" />
      <path d="M24 5.2a13 13 0 0 0 0 19.6 13 13 0 0 0 0-19.6z" fill="#FF5F00" />
    </svg>
  );
}

/** Full bank-themed credit-card face — ported 1:1 from the prototype (cards.jsx CreditCard / .cc). */
export function CreditCardWidget({
  bank,
  product,
  flag,
  themeKey,
  maskedNumber,
  holder = "Titular",
}: {
  bank: string;
  product: string;
  flag: string;
  themeKey?: string | null;
  maskedNumber?: string;
  holder?: string;
}) {
  const theme = resolveThemeKey(themeKey, bank);
  return (
    <div className={`cc ${theme}`}>
      <div className="cc-top">
        <div>
          <div className="cc-bank">{bank}</div>
          <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>{product}</div>
        </div>
        <div className="cc-chip" />
      </div>
      <div className="cc-num">{maskedNumber || "•••• •••• •••• ••••"}</div>
      <div className="cc-bottom">
        <div>
          <div style={{ fontSize: 9.5, letterSpacing: "0.1em", opacity: 0.65, textTransform: "uppercase" }}>
            Titular
          </div>
          <div className="cc-name">{holder}</div>
        </div>
        <div className="cc-brand">
          <CardBrand flag={flag} />
        </div>
      </div>
    </div>
  );
}
