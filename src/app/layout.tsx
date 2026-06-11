import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ServiceWorkerRegister } from "@/presentation/components/pwa/service-worker-register";
import { clashDisplay, satoshi } from "./_fonts";
import "./globals.css";
import "./prototype.css";

export const metadata: Metadata = {
  title: { default: "FinCore", template: "%s · FinCore" },
  description: "Gerencie suas finanças pessoais com clareza — contas, cartões, gastos compartilhados e mais.",
  applicationName: "FinCore",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "FinCore" },
};

export const viewport: Viewport = {
  themeColor: "#0c0a12",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`dark ${satoshi.variable} ${clashDisplay.variable}`}>
      <body>
        <div className="app-aura" aria-hidden="true" />
        <div className="app-grain" aria-hidden="true" />
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
