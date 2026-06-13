"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/app/_actions/auth";
import { NAV_GROUPS, SETTINGS_ITEM } from "@/presentation/components/shell/nav-items";
import { Icon } from "@/presentation/components/ui/icon";
import { LogoMark } from "@/presentation/components/ui/logo-mark";

const isActive = (pathname: string, href: string): boolean =>
  pathname === href || pathname.startsWith(`${href}/`);

export function Sidebar({
  userEmail,
  pendingCount,
  displayName,
}: {
  userEmail: string;
  pendingCount: number;
  displayName?: string;
}) {
  const pathname = usePathname();
  const name = displayName || userEmail.split("@")[0] || "Você";
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

  return (
    <aside className="sidebar">
      <Link href="/dashboard" className="brand">
        <LogoMark size={34} />
        <span className="word">
          Fin<b>Core</b>
        </span>
      </Link>

      {/* Single-account for now: just the name + email (no account-switcher affordance). */}
      <Link href="/settings" className="acct-switch">
        <span className="ava">{initials}</span>
        <span className="nm">
          <b>{name}</b>
          <span>{userEmail}</span>
        </span>
      </Link>

      {NAV_GROUPS.map((group) => (
        <div className="nav-group" key={group.label}>
          <div className="nav-label">{group.label}</div>
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item${isActive(pathname, item.href) ? " active" : ""}`}
            >
              <Icon name={item.icon} size={19} />
              {item.label}
              {item.badge && pendingCount > 0 && <span className="badge">{pendingCount}</span>}
            </Link>
          ))}
        </div>
      ))}

      <div className="nav-group" style={{ marginTop: "auto" }}>
        <Link
          href={SETTINGS_ITEM.href}
          className={`nav-item${isActive(pathname, SETTINGS_ITEM.href) ? " active" : ""}`}
        >
          <Icon name={SETTINGS_ITEM.icon} size={19} />
          {SETTINGS_ITEM.label}
        </Link>
      </div>

      <div className="sidebar-foot">
        <form action={signOutAction}>
          <button
            type="submit"
            className="nav-item"
            style={{ width: "100%", background: "none", border: 0, cursor: "pointer", textAlign: "left" }}
          >
            <Icon name="log-out" size={19} />
            Sair da conta
          </button>
        </form>
      </div>
    </aside>
  );
}
