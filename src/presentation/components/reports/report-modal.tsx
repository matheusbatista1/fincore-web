"use client";

import { useState } from "react";
import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import { CategoryIcon } from "@/presentation/components/ui/category-icon";
import { Dialog, DialogModal } from "@/presentation/components/ui/dialog";
import { Icon } from "@/presentation/components/ui/icon";
import { useUIStore } from "@/presentation/stores/ui-store";
import { formatBRLAbsolute } from "@/shared/formatting/currency";
import { relativeDateLabel } from "@/shared/formatting/dates";

export type ReportMode = "month" | "mine" | "person";

/** Serializable inputs assembled on the server for the report modal. */
export interface ReportData {
  readonly summary: {
    readonly generalIncomeCents: number;
    readonly generalExpenseCents: number;
    readonly personalIncomeCents: number;
    readonly personalExpenseCents: number;
    readonly aReceberCents: number;
    readonly aPagarCents: number;
  };
  readonly categories: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly color: string;
    readonly icon: string;
    readonly totalCents: number;
  }>;
  readonly byCard: ReadonlyArray<{ readonly id: string; readonly name: string; readonly valueCents: number }>;
  readonly people: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly relationship: string;
    readonly color: string;
    readonly balanceCents: number;
  }>;
  readonly transactions: TransactionListItem[];
  readonly today: string;
}

const TITLES: Record<ReportMode, string> = {
  month: "Relatório geral do mês",
  mine: "Meu relatório (pessoal)",
  person: "Relatório por pessoa",
};

function useMoney() {
  const privacy = useUIStore((s) => s.privacy);
  return (cents: number): string => (privacy ? "R$ ••••" : formatBRLAbsolute(cents));
}

/** Relatório (3 modos) — ported 1:1 from the prototype (extras.jsx ReportModal). */
export function ReportModal({
  data,
  initialMode,
  initialPersonId,
  onClose,
}: {
  data: ReportData;
  initialMode: ReportMode;
  initialPersonId?: string | undefined;
  onClose: () => void;
}) {
  const toast = useUIStore((s) => s.toast);
  const money = useMoney();
  const [mode, setMode] = useState<ReportMode>(initialMode);
  const [pid, setPid] = useState(
    initialPersonId ?? (data.people.find((p) => p.balanceCents !== 0) ?? data.people[0])?.id ?? "",
  );

  const { summary } = data;
  const othersAll = Math.max(0, summary.generalExpenseCents - summary.personalExpenseCents);
  const reimbAll = Math.max(0, summary.generalIncomeCents - summary.personalIncomeCents);

  // --- por pessoa ---
  const person = data.people.find((p) => p.id === pid);
  const groups = new Map<
    string,
    {
      label: string;
      icon: string;
      items: { desc: string; date: string; shareCents: number; income: boolean }[];
      totalCents: number;
    }
  >();
  if (person) {
    for (const t of data.transactions) {
      const share = t.shares.find((s) => s.personId === person.id);
      const isPayment = t.kind === "income" && t.fromPersonId === person.id;
      if (!share && !isPayment) continue;
      const key = t.cardId ?? t.accountId ?? t.sourceLabel ?? "outros";
      const label = t.sourceLabel ?? "Outros";
      const icon = t.cardId ? "credit-card" : t.accountId ? "wallet" : "file-text";
      let group = groups.get(key);
      if (!group) {
        group = { label, icon, items: [], totalCents: 0 };
        groups.set(key, group);
      }
      const shareCents = isPayment ? -t.amountCents : (share?.shareCents ?? 0);
      group.items.push({
        desc: t.description,
        date: relativeDateLabel(t.date, data.today),
        shareCents,
        income: isPayment,
      });
      group.totalCents += shareCents;
    }
  }
  const grpList = [...groups.values()];
  const grandTotal = grpList.reduce((s, g) => s + g.totalCents, 0);

  const exportName =
    mode === "person" && person
      ? (person.name.split(" ")[0] ?? person.name)
      : mode === "mine"
        ? "pessoal"
        : "geral do mês";

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogModal title={TITLES[mode]}>
        <div className="modal-body">
          <div className="seg" style={{ marginBottom: 18 }}>
            <button type="button" className={mode === "month" ? "on" : ""} onClick={() => setMode("month")}>
              Geral do mês
            </button>
            <button type="button" className={mode === "mine" ? "on" : ""} onClick={() => setMode("mine")}>
              Só eu
            </button>
            <button type="button" className={mode === "person" ? "on" : ""} onClick={() => setMode("person")}>
              Por pessoa
            </button>
          </div>

          {mode === "month" && (
            <div className="rep-month">
              <div className="summary-box" style={{ marginTop: 0, marginBottom: 16 }}>
                <div className="sb-row">
                  <span className="k">Receitas</span>
                  <span className="v" style={{ color: "var(--mint-500)" }}>
                    {money(summary.generalIncomeCents)}
                  </span>
                </div>
                <div className="sb-row">
                  <span className="k">Despesas</span>
                  <span className="v" style={{ color: "var(--rose-500)" }}>
                    {money(summary.generalExpenseCents)}
                  </span>
                </div>
                <div className="sb-row total">
                  <span className="k">Resultado do mês</span>
                  <span className="v">{money(summary.generalIncomeCents - summary.generalExpenseCents)}</span>
                </div>
              </div>
              <div className="rp-group">
                <div className="rp-group-head">
                  <span>Por categoria</span>
                  <span />
                </div>
                {data.categories.map((c) => (
                  <div className="split-row" key={c.id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <div className="sr-name" style={{ fontWeight: 500 }}>
                      <span className="pa" style={{ width: 24, height: 24, background: c.color }}>
                        <CategoryIcon name={c.icon} size={12} />
                      </span>
                      {c.name}
                    </div>
                    <div
                      className="sr-share"
                      style={{ width: "auto", color: "var(--text-hi)", fontWeight: 700 }}
                    >
                      {money(c.totalCents)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="rp-group">
                <div className="rp-group-head">
                  <span>Por cartão</span>
                  <span />
                </div>
                {data.byCard.map((c) => (
                  <div className="split-row" key={c.id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <div className="sr-name" style={{ fontWeight: 500 }}>
                      <span className="pa" style={{ width: 24, height: 24, background: "var(--surface-4)" }}>
                        <Icon name="credit-card" size={12} />
                      </span>
                      {c.name}
                    </div>
                    <div
                      className="sr-share"
                      style={{ width: "auto", color: "var(--text-hi)", fontWeight: 700 }}
                    >
                      {money(c.valueCents)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="summary-box" style={{ marginTop: 16 }}>
                <div className="sb-row">
                  <span className="k">A receber de pessoas</span>
                  <span className="v" style={{ color: "var(--mint-500)" }}>
                    {money(summary.aReceberCents)}
                  </span>
                </div>
                <div className="sb-row">
                  <span className="k">Você deve</span>
                  <span className="v" style={{ color: "var(--rose-500)" }}>
                    {money(summary.aPagarCents)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {mode === "mine" && (
            <div className="rep-mine">
              <div
                style={{
                  fontSize: 13,
                  color: "var(--text-lo)",
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  marginBottom: 14,
                  lineHeight: 1.45,
                }}
              >
                <Icon
                  name="info"
                  size={15}
                  style={{ color: "var(--purple-300)", flex: "none", marginTop: 1 }}
                />
                <span>
                  Considera apenas o que é seu: descontamos {money(othersAll)} de partes de terceiros e{" "}
                  {money(reimbAll)} de reembolsos recebidos.
                </span>
              </div>
              <div className="summary-box" style={{ marginTop: 0 }}>
                <div className="sb-row">
                  <span className="k">Minha renda (sem reembolsos)</span>
                  <span className="v" style={{ color: "var(--mint-500)" }}>
                    {money(summary.personalIncomeCents)}
                  </span>
                </div>
                <div className="sb-row">
                  <span className="k">Meu gasto real (só minha parte)</span>
                  <span className="v" style={{ color: "var(--rose-500)" }}>
                    {money(summary.personalExpenseCents)}
                  </span>
                </div>
                <div className="sb-row total">
                  <span className="k">Minha sobra real</span>
                  <span className="v">
                    {money(summary.personalIncomeCents - summary.personalExpenseCents)}
                  </span>
                </div>
              </div>
              <div className="summary-box" style={{ marginTop: 14 }}>
                <div className="sb-row">
                  <span className="k">Taxa de poupança</span>
                  <span className="v" style={{ color: "var(--purple-300)" }}>
                    {Math.round(
                      ((summary.personalIncomeCents - summary.personalExpenseCents) /
                        (summary.personalIncomeCents || 1)) *
                        100,
                    )}
                    %
                  </span>
                </div>
              </div>
            </div>
          )}

          {mode === "person" && person && (
            <div className="rep-person">
              <div className="report-person-pick">
                {data.people.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    className={`person-chip${pid === p.id ? " on" : ""}`}
                    onClick={() => setPid(p.id)}
                  >
                    <span className="pa" style={{ background: p.color }}>
                      {p.name[0]}
                    </span>
                    {p.name.split(" ")[0]}
                  </button>
                ))}
              </div>
              <div className="profile-head" style={{ marginBottom: 18 }}>
                <span
                  className="pava"
                  style={{ width: 56, height: 56, fontSize: 22, background: person.color }}
                >
                  {person.name
                    .split(" ")
                    .slice(0, 2)
                    .map((w) => w[0])
                    .join("")}
                </span>
                <div>
                  <h3 style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 600 }}>
                    {person.name}
                  </h3>
                  <div style={{ color: "var(--text-lo)", marginTop: 2, fontSize: 13 }}>
                    {person.relationship} · saldo atual {money(Math.abs(person.balanceCents))}
                  </div>
                </div>
              </div>
              {grpList.length === 0 && (
                <div
                  style={{ color: "var(--text-lo)", fontSize: 14, padding: "20px 0", textAlign: "center" }}
                >
                  Sem movimentações compartilhadas com {person.name.split(" ")[0]}.
                </div>
              )}
              {grpList.map((g) => (
                <div className="rp-group" key={g.label}>
                  <div className="rp-group-head">
                    <span className="row gap-2">
                      <Icon name={g.icon} size={14} />
                      {g.label}
                    </span>
                    <span className="tnum">{money(g.totalCents)}</span>
                  </div>
                  {g.items.map((it, j) => (
                    <div
                      className="split-row"
                      key={`${it.desc}-${it.date}-${it.shareCents}`}
                      style={{ borderBottom: j === g.items.length - 1 ? 0 : "1px solid var(--line)" }}
                    >
                      <div className="sr-name" style={{ fontWeight: 500, color: "var(--text-mid)" }}>
                        {it.income ? "↩ " : ""}
                        {it.desc}
                        <span style={{ fontSize: 12, color: "var(--text-faint)", marginLeft: 8 }}>
                          {it.date}
                        </span>
                      </div>
                      <div
                        className="sr-share"
                        style={{
                          width: "auto",
                          color: it.shareCents < 0 ? "var(--mint-500)" : "var(--text-hi)",
                          fontWeight: 700,
                        }}
                      >
                        {money(Math.abs(it.shareCents))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              {grpList.length > 0 && (
                <div className="summary-box" style={{ marginTop: 18 }}>
                  <div className="sb-row total">
                    <span className="k">Saldo com {person.name.split(" ")[0]}</span>
                    <span className="v">{money(grandTotal)}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => toast(`Relatório (${exportName}) exportado em CSV`)}
          >
            <Icon name="file-spreadsheet" size={16} />
            CSV
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => toast(`Relatório (${exportName}) exportado em PDF`)}
          >
            <Icon name="file-down" size={16} />
            Exportar PDF
          </button>
        </div>
      </DialogModal>
    </Dialog>
  );
}
