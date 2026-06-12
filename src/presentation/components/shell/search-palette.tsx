"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import { Avatar } from "@/presentation/components/ui/avatar";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";
import { openTxDetail } from "@/presentation/stores/tx-ui-store";
import { relativeDateLabel } from "@/shared/formatting/dates";

export interface SearchPerson {
  readonly id: string;
  readonly name: string;
  readonly relationship: string;
  readonly color: string;
  readonly balanceCents: number;
}
export interface SearchCard {
  readonly id: string;
  readonly bank: string;
  readonly product: string;
  readonly maskedNumber: string;
}

const NAV: ReadonlyArray<[string, string, string]> = [
  ["/dashboard", "Dashboard", "layout-dashboard"],
  ["/wallets", "Carteiras", "wallet"],
  ["/cards", "Cartões", "credit-card"],
  ["/transactions", "Transações", "arrow-left-right"],
  ["/people", "Pessoas", "users"],
  ["/reports", "Relatórios", "chart-pie"],
];

/** Busca ⌘K — ported 1:1 from the prototype (extras.jsx SearchPalette). */
export function SearchPalette({
  people,
  cards,
  transactions,
  today,
  onClose,
}: {
  people: SearchPerson[];
  cards: SearchCard[];
  transactions: TransactionListItem[];
  today: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const term = q.trim().toLowerCase();
  const match = (s: string) => s.toLowerCase().includes(term);
  const txHits = term
    ? transactions.filter((t) => match(t.description) || (t.note ? match(t.note) : false)).slice(0, 6)
    : transactions.slice(0, 4);
  const peopleHits = term
    ? people.filter((p) => match(p.name) || match(p.relationship)).slice(0, 5)
    : people.slice(0, 3);
  const cardHits = term ? cards.filter((c) => match(c.bank) || match(c.product)).slice(0, 4) : [];
  const navHits = term ? NAV.filter(([, label]) => match(label)) : [];

  const empty = term && !txHits.length && !peopleHits.length && !cardHits.length && !navHits.length;

  function go(href: string) {
    router.push(href);
    onClose();
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: scrim click-to-close, 1:1 with the prototype (Escape also closes).
    <div
      className="overlay search-overlay"
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stops scrim close inside the palette. */}
      <div className="search-palette" onClick={(e) => e.stopPropagation()} onKeyDown={() => {}}>
        <div className="sp-input">
          <Icon name="search" size={19} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar transações, pessoas, cartões, telas…"
          />
          <kbd>ESC</kbd>
        </div>
        <div className="sp-results">
          {empty && (
            <div className="sp-empty">
              <Icon name="search-x" size={26} />
              <span>Nada encontrado para “{q}”.</span>
            </div>
          )}

          {navHits.length > 0 && <div className="sp-group">Telas</div>}
          {navHits.map(([href, label, icon]) => (
            <button type="button" key={href} className="sp-item" onClick={() => go(href)}>
              <span className="sp-ic">
                <Icon name={icon} size={17} />
              </span>
              <span className="sp-main">{label}</span>
              <Icon name="corner-down-left" size={14} />
            </button>
          ))}

          {txHits.length > 0 && <div className="sp-group">{term ? "Transações" : "Recentes"}</div>}
          {txHits.map((t) => {
            const cat = t.category;
            return (
              <button
                type="button"
                key={t.id}
                className="sp-item"
                onClick={() => {
                  openTxDetail(t);
                  onClose();
                }}
              >
                <span
                  className="sp-ic"
                  style={
                    cat
                      ? { background: `${cat.color}22`, color: cat.color }
                      : { background: "var(--mint-soft)", color: "var(--mint-500)" }
                  }
                >
                  <Icon name={cat ? cat.icon : "arrow-down-left"} size={16} />
                </span>
                <span className="sp-main">
                  {t.description || (t.kind === "transfer" ? "Transferência" : "Lançamento")}
                  <small>{relativeDateLabel(t.date, today)}</small>
                </span>
                {t.kind === "transfer" ? (
                  <span className="tnum" style={{ color: "var(--sky-500)", fontWeight: 700, fontSize: 13.5 }}>
                    <Money cents={t.transferValueCents ?? 0} withSign={false} />
                  </span>
                ) : (
                  <span className={`tnum ${t.amountCents < 0 ? "sp-neg" : "sp-pos"}`}>
                    <Money cents={t.amountCents} />
                  </span>
                )}
              </button>
            );
          })}

          {peopleHits.length > 0 && <div className="sp-group">Pessoas</div>}
          {peopleHits.map((p) => (
            <button type="button" key={p.id} className="sp-item" onClick={() => go("/people")}>
              <span style={{ marginRight: 2 }}>
                <Avatar name={p.name} color={p.color} size={30} radius={9} />
              </span>
              <span className="sp-main">
                {p.name}
                <small>{p.relationship}</small>
              </span>
              {p.balanceCents !== 0 && (
                <span className={`tnum ${p.balanceCents > 0 ? "sp-pos" : "sp-neg"}`}>
                  <Money cents={Math.abs(p.balanceCents)} withSign={false} />
                </span>
              )}
            </button>
          ))}

          {cardHits.length > 0 && <div className="sp-group">Cartões</div>}
          {cardHits.map((c) => (
            <button type="button" key={c.id} className="sp-item" onClick={() => go("/cards")}>
              <span className="sp-ic">
                <Icon name="credit-card" size={16} />
              </span>
              <span className="sp-main">
                {c.bank} · {c.product}
                <small>{c.maskedNumber}</small>
              </span>
            </button>
          ))}
        </div>
        <div className="sp-foot">
          <span>
            <kbd>⏎</kbd> abrir
          </span>
          <span>
            <kbd>esc</kbd> fechar
          </span>
        </div>
      </div>
    </div>
  );
}
