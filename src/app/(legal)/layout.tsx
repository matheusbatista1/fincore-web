import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { LogoMark } from "@/presentation/components/ui/logo-mark";

const WRAP: CSSProperties = { minHeight: "100dvh", position: "relative" };
const INNER: CSSProperties = {
  maxWidth: 760,
  margin: "0 auto",
  padding: "32px 20px 80px",
  position: "relative",
};
const HEAD: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 24,
};
const BRAND: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontWeight: 600,
  fontSize: 20,
  color: "var(--text-hi)",
};

/** Public chrome for the legal pages (privacy / terms) — outside the app shell. */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div style={WRAP}>
      <div className="app-aura" />
      <div style={INNER}>
        <header style={HEAD}>
          <Link href="/" className="row gap-2" style={{ alignItems: "center" }}>
            <LogoMark size={32} />
            <span style={BRAND}>
              Fin<span style={{ color: "var(--purple-400)" }}>Core</span>
            </span>
          </Link>
          <Link href="/login" className="btn btn-ghost btn-sm">
            Voltar ao login
          </Link>
        </header>
        <main className="card card-pad">{children}</main>
        <footer style={{ marginTop: 18, display: "flex", gap: 16, justifyContent: "center" }}>
          <Link href="/privacy" className="lf-link">
            Privacidade
          </Link>
          <Link href="/terms" className="lf-link">
            Termos de uso
          </Link>
        </footer>
      </div>
    </div>
  );
}
