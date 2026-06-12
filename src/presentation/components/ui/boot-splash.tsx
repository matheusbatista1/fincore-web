import { LogoMark } from "@/presentation/components/ui/logo-mark";

/**
 * Loading splash — ported 1:1 from the prototype (system.jsx Loading): floating
 * logo with a spinning ring, brand word, indeterminate bar and a label.
 * `full` renders the fixed fullscreen boot (F5 / post-login); without it, a
 * compact centered spinner for in-page route transitions.
 */
export function BootSplash({ label, full = false }: { label: string; full?: boolean }) {
  const inner = (
    <>
      <div className="boot-mark">
        <LogoMark size={72} />
        <span className="boot-ring" />
      </div>
      <div className="boot-word">
        Fin<b>Core</b>
      </div>
      <div className="boot-bar">
        <span />
      </div>
      <div className="boot-label">{label}</div>
    </>
  );

  if (full) {
    return (
      <div className="boot">
        <div className="app-aura boot-aura" />
        <div className="boot-inner">{inner}</div>
        <div className="boot-foot">Protegido com criptografia de ponta a ponta.</div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {inner}
    </div>
  );
}
