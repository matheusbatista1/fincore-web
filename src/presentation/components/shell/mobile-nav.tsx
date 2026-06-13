"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  NewTransactionDialog,
  type TxFormAccount,
  type TxFormCard,
  type TxFormCategory,
  type TxFormPerson,
} from "@/presentation/components/forms/new-transaction-dialog";
import { visibleMobileMore, visibleMobileTabs } from "@/presentation/components/shell/nav-items";
import { Icon } from "@/presentation/components/ui/icon";
import { useModules } from "@/presentation/providers/modules-provider";

const isActive = (pathname: string, href: string): boolean =>
  pathname === href || pathname.startsWith(`${href}/`);

export function MobileNav({
  accounts,
  cards,
  people,
  categories,
  pendingCount,
}: {
  accounts: TxFormAccount[];
  cards: TxFormCard[];
  people: TxFormPerson[];
  categories: TxFormCategory[];
  pendingCount: number;
}) {
  const pathname = usePathname();
  const enabled = useModules();
  const tabs = visibleMobileTabs(enabled);
  const more = visibleMobileMore(enabled);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = more.some((i) => isActive(pathname, i.href));

  return (
    <>
      <nav className="bottom-nav">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`bn-item${isActive(pathname, tab.href) ? " active" : ""}`}
          >
            <Icon name={tab.icon} size={22} />
            <span>{tab.label}</span>
            {tab.badge && pendingCount > 0 && <span className="bn-dot" />}
          </Link>
        ))}
        <button
          type="button"
          className={`bn-item${moreActive ? " active" : ""}`}
          onClick={() => setMoreOpen(true)}
        >
          <Icon name="menu" size={22} />
          <span>Mais</span>
        </button>
      </nav>

      <NewTransactionDialog
        accounts={accounts}
        cards={cards}
        people={people}
        categories={categories}
        trigger={
          <button type="button" className="fab" aria-label="Novo lançamento">
            <Icon name="plus" size={26} />
          </button>
        }
      />

      {moreOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: backdrop closes the sheet (keyboard via Escape below).
        <div
          className="sheet-scrim"
          onClick={() => setMoreOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setMoreOpen(false);
          }}
        >
          {/* biome-ignore lint/a11y/noStaticElementInteractions: stops the sheet body from closing on click. */}
          <div className="sheet" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <div className="sheet-grip" />
            <h3 className="sheet-title">Mais</h3>
            <div className="more-grid">
              {more.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={`more-tile${isActive(pathname, item.href) ? " on" : ""}`}
                >
                  <span className="mt-ic">
                    <Icon name={item.icon} size={22} />
                  </span>
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
