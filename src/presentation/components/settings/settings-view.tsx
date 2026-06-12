"use client";

import { useState } from "react";
import { ProfileFormDialog } from "@/presentation/components/settings/profile-form-dialog";
import { Icon } from "@/presentation/components/ui/icon";
import { useIsMobile } from "@/presentation/lib/use-is-mobile";

type PrefKey = "notif" | "biometric" | "hideOnOpen";

/** `mobileOnly` prefs (push notifications, biometric login) are device features — hidden on desktop. */
const PREFS: ReadonlyArray<{ key: PrefKey; icon: string; title: string; sub: string; mobileOnly?: boolean }> =
  [
    {
      key: "notif",
      icon: "bell",
      title: "Notificações push",
      sub: "Vencimentos, pendências e alertas",
      mobileOnly: true,
    },
    {
      key: "biometric",
      icon: "fingerprint",
      title: "Login por biometria",
      sub: "Face ID / impressão digital",
      mobileOnly: true,
    },
    {
      key: "hideOnOpen",
      icon: "eye-off",
      title: "Ocultar valores ao abrir",
      sub: "Privacidade extra em locais públicos",
    },
  ];

/** Settings — profile header + preferences toggles, ported 1:1 from the prototype (more.jsx SettingsScreen). */
export function SettingsView({ name, email, initials }: { name: string; email: string; initials: string }) {
  const isMobile = useIsMobile();
  const [prefs, setPrefs] = useState<Record<PrefKey, boolean>>({
    notif: true,
    biometric: true,
    hideOnOpen: false,
  });
  const toggle = (k: PrefKey) => setPrefs((p) => ({ ...p, [k]: !p[k] }));
  const visiblePrefs = PREFS.filter((p) => isMobile || !p.mobileOnly);

  return (
    <>
      <div
        className="card card-pad settings-head"
        style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 18 }}
      >
        <span
          className="pava"
          style={{
            width: 64,
            height: 64,
            borderRadius: 20,
            fontSize: 24,
            background: "linear-gradient(135deg,var(--purple-400),var(--purple-700))",
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontWeight: 700,
          }}
        >
          {initials}
        </span>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 600 }}>{name}</h3>
          <div style={{ color: "var(--text-lo)", marginTop: 2 }}>{email}</div>
        </div>
        <ProfileFormDialog
          name={name}
          email={email}
          trigger={
            <button type="button" className="btn btn-ghost">
              <Icon name="pencil" size={16} />
              Editar perfil
            </button>
          }
        />
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Preferências</h3>
          </div>
        </div>
        <div className="card-pad" style={{ paddingTop: 4, paddingBottom: 8 }}>
          {visiblePrefs.map((p) => (
            <div
              role="button"
              tabIndex={0}
              className="lrow"
              key={p.key}
              style={{ cursor: "pointer" }}
              onClick={() => toggle(p.key)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggle(p.key);
                }
              }}
            >
              <span className="l-ic">
                <Icon name={p.icon} size={18} />
              </span>
              <div className="l-main">
                <div className="l-title">{p.title}</div>
                <div className="l-sub">{p.sub}</div>
              </div>
              <span className={`fc-switch${prefs[p.key] ? " on" : ""}`}>
                <span />
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
