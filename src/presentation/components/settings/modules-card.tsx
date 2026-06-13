"use client";

import { useState, useTransition } from "react";
import { updateModulesAction } from "@/app/_actions/auth";
import { Icon } from "@/presentation/components/ui/icon";
import { toast } from "@/presentation/stores/ui-store";
import { type ModuleKey, OPTIONAL_MODULES } from "@/shared/modules";

/**
 * Settings card to turn optional modules on/off. Persists via `updateModulesAction`
 * (which revalidates the layout so nav/widgets update). Disabling never deletes
 * data — it only hides everything related to the module.
 */
export function ModulesCard({ enabled }: { enabled: ModuleKey[] }) {
  const [on, setOn] = useState<ReadonlySet<ModuleKey>>(new Set(enabled));
  const [, startTransition] = useTransition();

  function toggle(key: ModuleKey) {
    const willEnable = !on.has(key);
    setOn((cur) => {
      const next = new Set(cur);
      if (willEnable) next.add(key);
      else next.delete(key);
      return next;
    });
    const label = OPTIONAL_MODULES.find((m) => m.key === key)?.label ?? "Módulo";
    startTransition(async () => {
      const next = new Set(on);
      if (willEnable) next.add(key);
      else next.delete(key);
      const result = await updateModulesAction({ modules: [...next] });
      if (!result.ok) {
        // Revert the optimistic toggle on failure.
        setOn((cur) => {
          const back = new Set(cur);
          if (willEnable) back.delete(key);
          else back.add(key);
          return back;
        });
        toast(result.error, "error");
        return;
      }
      toast(`${label} ${willEnable ? "ativado" : "desativado"}.`);
    });
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <div>
          <h3>Seções do app</h3>
          <div className="ch-sub">
            Ative só o que você usa — dá para mudar quando quiser, sem perder dados.
          </div>
        </div>
      </div>
      <div className="card-pad" style={{ paddingTop: 4, paddingBottom: 8 }}>
        {OPTIONAL_MODULES.map((m) => (
          <div
            role="button"
            tabIndex={0}
            className="lrow"
            key={m.key}
            style={{ cursor: "pointer" }}
            onClick={() => toggle(m.key)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggle(m.key);
              }
            }}
          >
            <span className="l-ic">
              <Icon name={m.icon} size={18} />
            </span>
            <div className="l-main">
              <div className="l-title">{m.label}</div>
              <div className="l-sub" style={{ whiteSpace: "normal", lineHeight: 1.45 }}>
                {m.description}
              </div>
            </div>
            <span className={`fc-switch${on.has(m.key) ? " on" : ""}`}>
              <span />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
