/**
 * Bank card themes — gradient backgrounds per bank/style, ported 1:1 from the
 * prototype (`styles/screens.css` `.cc.<theme>` + `app/data.js` THEME_ACCENT).
 * The accent is used for non-card surfaces (avatars, meters) tied to the theme.
 */
export interface BankTheme {
  readonly gradient: string;
  readonly accent: string;
  /** Optional override for the brand/flag text color on dark metal themes. */
  readonly flagColor?: string;
}

export const BANK_THEMES: Record<string, BankTheme> = {
  nubank: { gradient: "linear-gradient(150deg, #8A05BE 0%, #5B0B86 60%, #3A0758 100%)", accent: "#B14BE0" },
  itau: { gradient: "linear-gradient(150deg, #003B8E 0%, #00255C 100%)", accent: "#3D7BE8" },
  c6: {
    gradient: "linear-gradient(150deg, #2B2B2E 0%, #0E0E10 100%)",
    accent: "#AEB4BD",
    flagColor: "#E8C77E",
  },
  santander: { gradient: "linear-gradient(150deg, #D11414 0%, #8A0606 100%)", accent: "#F2566B" },
  mp: { gradient: "linear-gradient(150deg, #2B7BE4 0%, #134B97 100%)", accent: "#56A8F2" },
  inter: { gradient: "linear-gradient(150deg, #FF7A00 0%, #C24F00 100%)", accent: "#FF8A3D" },
  bb: { gradient: "linear-gradient(150deg, #1B3F8B 0%, #0A2452 100%)", accent: "#F2C84B" },
  caixa: { gradient: "linear-gradient(150deg, #1B7FC4 0%, #0A3F66 100%)", accent: "#2F7BD8" },
  picpay: { gradient: "linear-gradient(150deg, #16C95B 0%, #0A8F4F 100%)", accent: "#21C25E" },
  btg: {
    gradient: "linear-gradient(150deg, #1C2A3A 0%, #070D15 100%)",
    accent: "#6B7CA0",
    flagColor: "#C9D4E0",
  },
  xp: {
    gradient: "linear-gradient(150deg, #232323 0%, #050505 100%)",
    accent: "#E8B53D",
    flagColor: "#E8C77E",
  },
  roxo: { gradient: "linear-gradient(150deg, #7C5CFF 0%, #4B2DB3 100%)", accent: "#9B79FF" },
  grafite: { gradient: "linear-gradient(150deg, #2B2B30 0%, #0E0E12 100%)", accent: "#8A93A6" },
  esmeralda: { gradient: "linear-gradient(150deg, #1FB57A 0%, #0C7A50 100%)", accent: "#34E1A8" },
  oceano: { gradient: "linear-gradient(150deg, #2C9CD6 0%, #15567E 100%)", accent: "#56B6F2" },
  carmim: { gradient: "linear-gradient(150deg, #E0506B 0%, #8E1F32 100%)", accent: "#FB6E83" },
  dourado: { gradient: "linear-gradient(150deg, #C9A24B 0%, #7A5A14 100%)", accent: "#E8C77E" },
  rosa: { gradient: "linear-gradient(150deg, #E36FD0 0%, #9C2C8C 100%)", accent: "#E36FD0" },
  cinza: { gradient: "linear-gradient(150deg, #9AA1AC 0%, #5A6068 100%)", accent: "#9AA1AC" },
};

export const BANK_THEME_KEYS = Object.keys(BANK_THEMES);
export const DEFAULT_BANK_THEME = "grafite";

const FALLBACK_THEME: BankTheme = {
  gradient: "linear-gradient(150deg, #2B2B30 0%, #0E0E12 100%)",
  accent: "#8A93A6",
};

/** Keyword → theme guesses for when a card/account has no explicit themeKey. */
const NAME_GUESSES: ReadonlyArray<[RegExp, string]> = [
  [/nubank|nu /i, "nubank"],
  [/ita[uú]/i, "itau"],
  [/c6/i, "c6"],
  [/santander/i, "santander"],
  [/mercado|mp\b/i, "mp"],
  [/inter/i, "inter"],
  [/banco do brasil|bb\b/i, "bb"],
  [/caixa/i, "caixa"],
  [/picpay/i, "picpay"],
  [/btg/i, "btg"],
  [/\bxp\b/i, "xp"],
];

/** Resolve a theme from an explicit key, falling back to a guess from the bank name. */
export function resolveBankTheme(themeKey: string | null | undefined, bankName = ""): BankTheme {
  const explicit = themeKey ? BANK_THEMES[themeKey] : undefined;
  if (explicit) return explicit;
  const guess = NAME_GUESSES.find(([re]) => re.test(bankName))?.[1];
  const guessed = guess ? BANK_THEMES[guess] : undefined;
  return guessed ?? FALLBACK_THEME;
}
