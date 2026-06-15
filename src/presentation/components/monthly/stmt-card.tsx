"use client";

import type { CSSProperties, KeyboardEvent } from "react";
import type { MonthlyItem } from "@/application/use-cases/get-monthly";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";
import { openTxDetail } from "@/presentation/stores/tx-ui-store";
import { relativeDateLabel } from "@/shared/formatting/dates";

/** A person's "a receber" for the month, shown inside the income group (general lens only). */
export interface ReceivableRow {
  readonly id: string;
  readonly name: string;
  readonly amountCents: number;
}

export interface StmtGroup {
  readonly key: string;
  readonly name: string;
  readonly sub?: string;
  /** Overrides the default "{sub} · {n} lançamentos" subtitle entirely. */
  readonly countText?: string;
  readonly accent: string;
  readonly icon: string;
  readonly items: MonthlyItem[];
  readonly totalCents: number;
  /** Which money bucket this group is — drives the personal-lens recompute. */
  readonly lens?: "income" | "expense" | "transfer";
  /** People who owe you this month — appended to the income card under the general lens.
   * Not part of `totalCents` (which stays transaction-only for the export); the card adds them. */
  readonly receivables?: readonly ReceivableRow[] | undefined;
}

function StmtRow({ item, today }: { item: MonthlyItem; today: string }) {
  const isTransfer = item.kind === "transfer";
  const cat = item.category;
  const icStyle: CSSProperties = isTransfer
    ? { background: "var(--sky-soft)", color: "var(--sky-500)" }
    : cat
      ? { background: `${cat.color}22`, color: cat.color }
      : { background: "var(--mint-soft)", color: "var(--mint-500)" };
  const iconName = isTransfer ? "arrow-left-right" : cat ? cat.icon : "arrow-down-left";
  const sub = isTransfer
    ? item.transferFromName && item.transferToName
      ? `${item.transferFromName} → ${item.transferToName}`
      : ""
    : (item.sourceLabel ?? (cat ? cat.name : ""));

  // A projected ("previsto") row opens its real anchor so the rule can be edited/deleted.
  const target = item.anchor ?? item;
  const open = () => openTxDetail(target);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      className="lrow"
      style={{ cursor: "pointer" }}
    >
      <span className="l-ic" style={icStyle}>
        <Icon name={iconName} size={18} />
      </span>
      <div className="l-main">
        <div className="l-title">
          {item.description || (isTransfer ? "Transferência" : "Lançamento")}
          {item.isFixed && (
            <span
              className="parc-badge"
              style={{ marginLeft: 8, background: "var(--purple-soft)", color: "var(--purple-300)" }}
            >
              <Icon name="repeat" size={11} />
              fixo
            </span>
          )}
          {item.projected && (
            <span className="parc-badge futura" style={{ marginLeft: 6 }}>
              previsto
            </span>
          )}
          {item.parcela && (
            <span className="parc-badge" style={{ marginLeft: 6 }}>
              {item.parcela.number}/{item.parcela.total}
            </span>
          )}
        </div>
        <div className="l-sub">
          {relativeDateLabel(item.date, today)}
          {sub ? ` · ${sub}` : ""}
        </div>
      </div>
      {isTransfer ? (
        <div className="l-amt" style={{ color: "var(--sky-500)" }}>
          <Money cents={item.transferValueCents ?? 0} withSign={false} />
        </div>
      ) : (
        <div className={`l-amt ${item.amountCents < 0 ? "neg" : "pos"}`}>
          <Money cents={item.amountCents} />
        </div>
      )}
    </div>
  );
}

/** Statement card grouped by origin — ported 1:1 from the prototype (monthly.jsx StmtCard). */
export function StmtCard({ group, today }: { group: StmtGroup; today: string }) {
  const receivables = group.receivables ?? [];
  const recvTotal = receivables.reduce((s, r) => s + r.amountCents, 0);
  // The receivables are shown but not in `totalCents` (kept transaction-only for the export),
  // so the card header adds them back to match the on-screen "Entradas" total.
  const displayTotal = group.totalCents + recvTotal;
  const itemsText = `${group.items.length} ${group.items.length === 1 ? "lançamento" : "lançamentos"}`;
  const subtitle =
    receivables.length > 0
      ? `${group.items.length > 0 ? `${group.items.length} ${group.items.length === 1 ? "entrada" : "entradas"} · ` : ""}${receivables.length} a receber`
      : (group.countText ?? `${group.sub ? `${group.sub} · ` : ""}${itemsText}`);

  return (
    <div className="card stmt">
      <div className="stmt-head" style={{ ["--accent" as string]: group.accent } as CSSProperties}>
        <span className="sh-ic" style={{ background: `${group.accent}22`, color: group.accent }}>
          <Icon name={group.icon} size={18} />
        </span>
        <div className="sh-main">
          <b>{group.name}</b>
          <small>{subtitle}</small>
        </div>
        <span className="sh-tot" style={group.key === "income" ? { color: group.accent } : undefined}>
          <Money cents={displayTotal} withSign={false} />
        </span>
      </div>
      <div className="stmt-body">
        {group.items.map((item) => (
          <StmtRow key={item.id} item={item} today={today} />
        ))}
        {receivables.map((r) => (
          <div className="lrow" key={`recv-${r.id}`}>
            <span className="l-ic" style={{ background: "var(--mint-soft)", color: "var(--mint-500)" }}>
              <Icon name="users" size={18} />
            </span>
            <div className="l-main">
              <div className="l-title">{r.name}</div>
              <div className="l-sub">A receber no mês</div>
            </div>
            <div className="l-amt pos">
              <Money cents={r.amountCents} withSign={false} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
