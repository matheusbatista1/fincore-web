"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_GROUPS, SETTINGS_ITEM } from "@/presentation/components/shell/nav-items";
import { Icon } from "@/presentation/components/ui/icon";
import { LogoMark } from "@/presentation/components/ui/logo-mark";

const isActive = (pathname: string, href: string): boolean =>
  pathname === href || pathname.startsWith(`${href}/`);

export function Sidebar({ userEmail, pendingCount }: { userEmail: string; pendingCount: number }) {
  const pathname = usePathname();
  const name = userEmail.split("@")[0] || "Você";
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <aside className="sidebar">
      <div className="brand">
        <LogoMark size={34} />
        <span className="word">
          Fin<b>Core</b>
        </span>
      </div>

      <Link href="/settings" className="acct-switch">
        <span className="ava">{initials}</span>
        <span className="nm">
          <b>{name}</b>
          <span>{userEmail}</span>
        </span>
        <Icon name="chevrons-up-down" size={16} />
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
        <Link href="/reports" className="insight">
          <span className="ii" style={{ background: "var(--purple-soft)", color: "var(--purple-300)" }}>
            <Icon name="sparkles" size={16} />
          </span>
          <p>
            <b>FinCore Plus</b>
            <br />
            Relatórios ilimitados e IA financeira.
          </p>
        </Link>
      </div>
    </aside>
  );
}
