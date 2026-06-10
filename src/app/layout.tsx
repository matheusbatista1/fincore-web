import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "FinCore", template: "%s · FinCore" },
  description: "Gerencie suas finanças pessoais com clareza — contas, cartões, gastos compartilhados e mais.",
  applicationName: "FinCore",
};

export const viewport: Viewport = {
  themeColor: "#0c0a12",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <body>
        <div className="app-aura" aria-hidden="true" />
        <div className="app-grain" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
