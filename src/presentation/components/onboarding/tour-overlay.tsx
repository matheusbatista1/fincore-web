"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { Icon } from "@/presentation/components/ui/icon";
import { useOnboardingStore } from "@/presentation/stores/onboarding-store";

type Placement = "bottom" | "top" | "right" | "left";

interface TourStep {
  /** CSS selector for the highlighted element (a `data-tour` attribute). */
  readonly sel: string;
  readonly title: string;
  readonly body: string;
  readonly place: Placement;
}

/** The guided steps. Steps whose target isn't on screen (e.g. desktop-only nav) are skipped. */
const STEPS: readonly TourStep[] = [
  {
    sel: '[data-tour="nav"]',
    title: "Navegação",
    body: "Acesse as seções do app por aqui. Você liga ou desliga seções quando quiser, nas Configurações.",
    place: "right",
  },
  {
    sel: '[data-tour="new-tx"]',
    title: "Novo lançamento",
    body: "Toque aqui para adicionar uma receita, despesa ou transferência — com parcelas e categorias.",
    place: "bottom",
  },
  {
    sel: '[data-tour="privacy"]',
    title: "Privacidade",
    body: "Esconda todos os valores com um toque. Ótimo para abrir o app em locais públicos.",
    place: "bottom",
  },
  {
    sel: '[data-tour="settings"]',
    title: "Configurações",
    body: "Edite seu perfil, ajuste preferências e escolha quais seções aparecem no app.",
    place: "right",
  },
];

const BALLOON_W = 300;
const BALLOON_H = 168;
const PAD = 8;
const GAP = 14;

/** First visible element matching the selector (skips display:none, e.g. the mobile/desktop twin). */
function visibleTarget(sel: string): HTMLElement | null {
  const els = Array.from(document.querySelectorAll<HTMLElement>(sel));
  return els.find((e) => e.getClientRects().length > 0) ?? null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Position the balloon relative to the target rect, kept inside the viewport. */
function balloonPosition(rect: DOMRect, place: Placement): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top: number;
  let left: number;
  if (place === "bottom") {
    top = rect.bottom + GAP;
    left = rect.left + rect.width / 2 - BALLOON_W / 2;
  } else if (place === "top") {
    top = rect.top - GAP - BALLOON_H;
    left = rect.left + rect.width / 2 - BALLOON_W / 2;
  } else if (place === "right") {
    top = rect.top;
    left = rect.right + GAP;
  } else {
    top = rect.top;
    left = rect.left - GAP - BALLOON_W;
  }
  // If the preferred side overflows, fall back below the target.
  if (left + BALLOON_W > vw - 12 || left < 12) {
    left = clamp(rect.left + rect.width / 2 - BALLOON_W / 2, 12, vw - BALLOON_W - 12);
    if (place === "right" || place === "left") top = rect.bottom + GAP;
  }
  top = clamp(top, 12, vh - BALLOON_H - 12);
  left = clamp(left, 12, vw - BALLOON_W - 12);
  return { top, left };
}

export function TourOverlay() {
  const active = useOnboardingStore((s) => s.tourActive);
  const step = useOnboardingStore((s) => s.step);
  const setStep = useOnboardingStore((s) => s.setStep);
  const endTour = useOnboardingStore((s) => s.endTour);

  // Lock the visible-step list in when the tour starts (targets are stable during it).
  const steps = useMemo(() => (active ? STEPS.filter((s) => visibleTarget(s.sel)) : []), [active]);
  const current = steps[step];

  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!active) return;
    if (steps.length === 0) {
      endTour();
      return;
    }
    if (!current) {
      endTour();
      return;
    }
    function update() {
      const el = current ? visibleTarget(current.sel) : null;
      setRect(el ? el.getBoundingClientRect() : null);
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [active, current, steps.length, endTour]);

  if (!active || !current || !rect) return null;

  const isLast = step >= steps.length - 1;
  const { top, left } = balloonPosition(rect, current.place);

  const spotlight: CSSProperties = {
    position: "fixed",
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
    borderRadius: 14,
    boxShadow: "0 0 0 9999px rgba(8, 6, 16, 0.66)",
    zIndex: 1000,
    pointerEvents: "none",
    transition: "all 0.2s cubic-bezier(0.2, 0.7, 0.3, 1)",
  };

  const balloon: CSSProperties = {
    position: "fixed",
    top,
    left,
    width: BALLOON_W,
    zIndex: 1001,
    background: "var(--surface-1)",
    border: "1px solid var(--line-2)",
    borderRadius: "var(--r-md)",
    boxShadow: "var(--sh-3, 0 18px 50px rgba(0,0,0,0.45))",
    padding: 18,
    animation: "fc-pop 0.2s cubic-bezier(0.2, 0.7, 0.3, 1) both",
  };

  return (
    <>
      <div style={spotlight} />
      <div style={balloon} role="dialog" aria-label={current.title}>
        <div
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}
        >
          <strong style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--text-hi)" }}>
            {current.title}
          </strong>
          <button
            type="button"
            className="icon-btn btn-sm"
            style={{ width: 30, height: 30 }}
            aria-label="Pular tutorial"
            onClick={endTour}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        <p style={{ fontSize: 13.5, color: "var(--text-lo)", lineHeight: 1.5, marginBottom: 16 }}>
          {current.body}
        </p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, color: "var(--text-faint)", fontWeight: 600 }}>
            {step + 1} de {steps.length}
          </span>
          <div className="row gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={endTour}>
              Pular
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => (isLast ? endTour() : setStep(step + 1))}
            >
              {isLast ? "Concluir" : "Próximo"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
