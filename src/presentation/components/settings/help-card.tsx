"use client";

import { Icon } from "@/presentation/components/ui/icon";
import { useOnboardingStore } from "@/presentation/stores/onboarding-store";

/** Settings card to re-open the welcome wizard or replay the guided tour. */
export function HelpCard() {
  const openWizard = useOnboardingStore((s) => s.openWizard);
  const startTour = useOnboardingStore((s) => s.startTour);

  const rows: ReadonlyArray<{ icon: string; title: string; sub: string; action: () => void }> = [
    {
      icon: "sparkles",
      title: "Rever boas-vindas",
      sub: "Escolha de novo quais seções você quer usar.",
      action: openWizard,
    },
    {
      icon: "info",
      title: "Refazer tutorial",
      sub: "Um tour rápido pelas principais funcionalidades.",
      action: startTour,
    },
  ];

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <div>
          <h3>Ajuda</h3>
          <div className="ch-sub">Reveja a introdução ou o tutorial guiado quando quiser.</div>
        </div>
      </div>
      <div className="card-pad" style={{ paddingTop: 4, paddingBottom: 8 }}>
        {rows.map((r) => (
          <div
            role="button"
            tabIndex={0}
            key={r.title}
            className="lrow"
            style={{ cursor: "pointer" }}
            onClick={r.action}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                r.action();
              }
            }}
          >
            <span className="l-ic">
              <Icon name={r.icon} size={18} />
            </span>
            <div className="l-main">
              <div className="l-title">{r.title}</div>
              <div className="l-sub">{r.sub}</div>
            </div>
            <Icon name="chevron-right" size={16} />
          </div>
        ))}
      </div>
    </div>
  );
}
