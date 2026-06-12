"use client";

import { Icon } from "@/presentation/components/ui/icon";

/** Error screen — ported 1:1 from the prototype (system.jsx ErrorScreen). */
export function ErrorScreen({ detail, onReload }: { detail?: string | undefined; onReload: () => void }) {
  return (
    <div className="errpage">
      <div className="app-aura" />
      <div className="errpage-inner">
        <div className="err-ic">
          <Icon name="unplug" size={34} />
        </div>
        <h1>Algo saiu do trilho</h1>
        <p>
          Encontramos um problema inesperado ao carregar esta parte do FinCore. Seus dados estão seguros — é
          só recarregar.
        </p>
        {detail && <pre className="err-detail">{detail}</pre>}
        <div className="row gap-3" style={{ justifyContent: "center", marginTop: 8 }}>
          <button type="button" className="btn btn-primary" onClick={onReload}>
            <Icon name="refresh-cw" size={17} />
            Recarregar
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              window.location.href = "/dashboard";
            }}
          >
            <Icon name="house" size={17} />
            Início
          </button>
        </div>
      </div>
    </div>
  );
}
