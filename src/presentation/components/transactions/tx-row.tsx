"use client";

import type { CSSProperties } from "react";
import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import { Avatar } from "@/presentation/components/ui/avatar";
import { Icon } from "@/presentation/components/ui/icon";
import { Money } from "@/presentation/components/ui/money";
import { useModuleEnabled } from "@/presentation/providers/modules-provider";
import { openInstallmentGroup, openTxDetail } from "@/presentation/stores/tx-ui-store";
import { relativeDateLabel } from "@/shared/formatting/dates";

/**
 * Transaction list row (.lrow); click opens the detail. When `parcelaCount` is set
 * the row represents a collapsed installment group — it shows an "Nx" badge and
 * opens the installment-group modal instead.
 */
export function TxRow({
  item,
  today,
  parcelaCount,
}: {
  item: TransactionListItem;
  today: string;
  parcelaCount?: number | undefined;
}) {
  const isTransfer = item.kind === "transfer";
  const cat = item.category;
  const peopleOn = useModuleEnabled("people");
  const groupId = item.installmentGroupId;
  const grouped = parcelaCount !== undefined && groupId !== null;
  const open = () => (grouped && groupId ? openInstallmentGroup(groupId) : openTxDetail(item));

  const icStyle: CSSProperties = isTransfer
    ? { background: "var(--sky-soft)", color: "var(--sky-500)" }
    : cat
      ? { background: `${cat.color}22`, color: cat.color }
      : { background: "var(--mint-soft)", color: "var(--mint-500)" };

  const iconName = isTransfer
    ? "arrow-left-right"
    : cat
      ? cat.icon
      : item.kind === "income"
        ? "arrow-down-left"
        : "arrow-up-right";

  const sub =
    item.sourceLabel ??
    (item.transferFromName && item.transferToName
      ? `${item.transferFromName} → ${item.transferToName}`
      : peopleOn && item.fromPersonName
        ? `Pagamento de ${item.fromPersonName}`
        : "");

  return (
    <div
      role="button"
      tabIndex={0}
      className="lrow"
      style={{ cursor: "pointer" }}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
    >
      <span className="l-ic" style={icStyle}>
        <Icon name={iconName} size={18} />
      </span>
      <div className="l-main">
        <div className="l-title tx-title">
          <span className="lt-text">{item.description || (isTransfer ? "Transferência" : "Lançamento")}</span>
          {grouped && <span className="parc-badge">{parcelaCount}x</span>}
        </div>
        <div className="l-sub">
          {relativeDateLabel(item.date, today)}
          {sub ? ` · ${sub}` : ""}
        </div>
      </div>
      <div className="row gap-3">
        {peopleOn && item.shares.length > 0 && (
          <div className="row" style={{ marginRight: 2 }}>
            {item.shares.slice(0, 3).map((p, i) => (
              <span
                key={p.personId}
                style={{ marginLeft: i ? -8 : 0, border: "2px solid var(--surface-1)", borderRadius: "50%" }}
              >
                <Avatar name={p.name} color={p.color} size={24} />
              </span>
            ))}
          </div>
        )}
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
    </div>
  );
}
