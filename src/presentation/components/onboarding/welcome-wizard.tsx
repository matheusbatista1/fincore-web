"use client";

import { useState } from "react";
import { Dialog, DialogModal } from "@/presentation/components/ui/dialog";
import { Icon } from "@/presentation/components/ui/icon";
import { LogoMark } from "@/presentation/components/ui/logo-mark";
import { type ModuleKey, OPTIONAL_MODULES } from "@/shared/modules";

const TITLES = ["Bem-vindo ao FinCore", "Escolha suas seções", "Tudo pronto!"] as const;

/**
 * First-run welcome wizard: intro → module picker → done. On finish it reports
 * the chosen modules to the host (which persists + may start the tour). Can be
 * re-opened from Settings ("Rever boas-vindas").
 */
export function WelcomeWizard({
  firstRun,
  initialModules,
  onFinish,
  onCancel,
}: {
  firstRun: boolean;
  initialModules: readonly ModuleKey[];
  onFinish: (modules: ModuleKey[]) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<ModuleKey>>(new Set(initialModules));

  function toggle(key: ModuleKey) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function finish() {
    onFinish([...selected]);
  }

  // Closing via ESC / scrim / X: first run still completes (so it won't reappear).
  function handleOpenChange(next: boolean) {
    if (next) return;
    if (firstRun) finish();
    else onCancel();
  }

  if (!open) return null;

  const chosenLabels = OPTIONAL_MODULES.filter((m) => selected.has(m.key)).map((m) => m.label);

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogModal title={TITLES[step] ?? "FinCore"} maxWidth={520}>
        <div className="modal-body">
          {step === 0 && (
            <div style={{ textAlign: "center", padding: "12px 8px 4px" }}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
                <LogoMark size={56} />
              </div>
              <h3 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--text-hi)" }}>
                Sua vida financeira, do seu jeito
              </h3>
              <p
                style={{
                  fontSize: 14.5,
                  color: "var(--text-lo)",
                  lineHeight: 1.55,
                  maxWidth: 380,
                  margin: "10px auto 0",
                }}
              >
                Em menos de um minuto você escolhe o que quer usar. Dá para começar simples e ativar mais
                seções quando precisar — nada some sem você querer.
              </p>
            </div>
          )}

          {step === 1 && (
            <>
              <p style={{ fontSize: 14, color: "var(--text-lo)", lineHeight: 1.5, marginBottom: 8 }}>
                Ative só o que faz sentido pra você. Você liga e desliga qualquer uma depois, nas
                Configurações.
              </p>
              {OPTIONAL_MODULES.map((m) => (
                <div
                  role="button"
                  tabIndex={0}
                  key={m.key}
                  className="lrow"
                  style={{ cursor: "pointer", alignItems: "flex-start" }}
                  onClick={() => toggle(m.key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggle(m.key);
                    }
                  }}
                >
                  <span className="l-ic" style={{ marginTop: 2 }}>
                    <Icon name={m.icon} size={18} />
                  </span>
                  <div className="l-main">
                    <div className="l-title">{m.label}</div>
                    <div className="l-sub" style={{ whiteSpace: "normal", lineHeight: 1.45 }}>
                      {m.description}
                    </div>
                  </div>
                  <span className={`fc-switch${selected.has(m.key) ? " on" : ""}`}>
                    <span />
                  </span>
                </div>
              ))}
            </>
          )}

          {step === 2 && (
            <div style={{ textAlign: "center", padding: "12px 8px 4px" }}>
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 20,
                  margin: "0 auto 16px",
                  display: "grid",
                  placeItems: "center",
                  background: "var(--mint-soft)",
                  color: "var(--mint-500)",
                }}
              >
                <Icon name="check" size={30} />
              </div>
              <h3 style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--text-hi)" }}>
                Pronto pra começar!
              </h3>
              <p
                style={{
                  fontSize: 14,
                  color: "var(--text-lo)",
                  lineHeight: 1.55,
                  maxWidth: 380,
                  margin: "10px auto 0",
                }}
              >
                {chosenLabels.length > 0
                  ? `Você ativou: ${chosenLabels.join(", ")}. Vamos dar uma olhada rápida pelo app.`
                  : "Você começou com o essencial. Quando quiser, ative mais seções nas Configurações. Vamos a um tour rápido."}
              </p>
            </div>
          )}
        </div>

        <div className="modal-foot">
          {step > 0 ? (
            <button type="button" className="btn btn-ghost" onClick={() => setStep((s) => s - 1)}>
              Voltar
            </button>
          ) : (
            <span />
          )}
          {step < 2 ? (
            <button type="button" className="btn btn-primary" onClick={() => setStep((s) => s + 1)}>
              {step === 0 ? "Começar" : "Avançar"}
              <Icon name="arrow-right" size={16} />
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={finish}>
              {firstRun ? "Concluir e ver o tour" : "Salvar"}
            </button>
          )}
        </div>
      </DialogModal>
    </Dialog>
  );
}
