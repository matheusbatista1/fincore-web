"use client";

import { useState } from "react";
import { resetCardBillDatesAction, setCardBillDatesAction } from "@/app/_actions/finance";
import { Dialog, DialogClose, DialogModal, DialogTrigger } from "@/presentation/components/ui/dialog";
import { Icon } from "@/presentation/components/ui/icon";
import { toast } from "@/presentation/stores/ui-store";

/** Edit the closing/due day of ONE bill (competence month) — overrides the card's default just here. */
export function CardBillDatesDialog({
  cardId,
  month,
  monthLabel,
  closingDay,
  dueDay,
  hasOverride,
}: {
  cardId: string;
  month: string;
  monthLabel: string;
  /** Effective closing day for this bill (override or default). */
  closingDay: number;
  /** Effective due day for this bill (override or default). */
  dueDay: number;
  hasOverride: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="btn btn-ghost btn-sm" title="Ajustar datas desta fatura">
          <Icon name="calendar-clock" size={15} />
          Datas
        </button>
      </DialogTrigger>
      {open && (
        <BillDatesForm
          cardId={cardId}
          month={month}
          monthLabel={monthLabel}
          closingDay={closingDay}
          dueDay={dueDay}
          hasOverride={hasOverride}
          onClose={() => setOpen(false)}
        />
      )}
    </Dialog>
  );
}

function clampDay(value: string): number {
  const n = Number.parseInt(value.replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? Math.min(31, Math.max(1, n)) : 1;
}

function BillDatesForm({
  cardId,
  month,
  monthLabel,
  closingDay,
  dueDay,
  hasOverride,
  onClose,
}: {
  cardId: string;
  month: string;
  monthLabel: string;
  closingDay: number;
  dueDay: number;
  hasOverride: boolean;
  onClose: () => void;
}) {
  const [closing, setClosing] = useState(String(closingDay));
  const [due, setDue] = useState(String(dueDay));
  const [submitting, setSubmitting] = useState(false);

  async function save() {
    if (submitting) return;
    setSubmitting(true);
    const result = await setCardBillDatesAction({
      cardId,
      month,
      closingDay: clampDay(closing),
      dueDay: clampDay(due),
    });
    setSubmitting(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast(`Datas da fatura de ${monthLabel} ajustadas.`);
    onClose();
  }

  async function reset() {
    if (submitting) return;
    setSubmitting(true);
    const result = await resetCardBillDatesAction({ cardId, month });
    setSubmitting(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast(`Fatura de ${monthLabel} voltou às datas padrão.`);
    onClose();
  }

  return (
    <DialogModal title={`Datas · fatura de ${monthLabel}`} maxWidth={420}>
      <div className="modal-body">
        <p style={{ margin: "0 0 14px", color: "var(--text-mid)", fontSize: 13.5, lineHeight: 1.5 }}>
          Ajuste o fechamento e o vencimento <b style={{ color: "var(--text-hi)" }}>só desta fatura</b>. Os
          outros meses seguem as datas padrão do cartão.
        </p>
        <div className="form-grid-2">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="cbd-closing">Dia de fechamento</label>
            <input
              id="cbd-closing"
              className="input tnum"
              inputMode="numeric"
              value={closing}
              onChange={(e) => setClosing(e.target.value.replace(/\D/g, ""))}
              placeholder="24"
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="cbd-due">Dia de vencimento</label>
            <input
              id="cbd-due"
              className="input tnum"
              inputMode="numeric"
              value={due}
              onChange={(e) => setDue(e.target.value.replace(/\D/g, ""))}
              placeholder="2"
            />
          </div>
        </div>
      </div>
      <div className="modal-foot" style={{ justifyContent: "space-between" }}>
        {hasOverride ? (
          <button type="button" className="btn btn-quiet" onClick={reset} disabled={submitting}>
            Voltar ao padrão
          </button>
        ) : (
          <span />
        )}
        <div className="row gap-2">
          <DialogClose asChild>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancelar
            </button>
          </DialogClose>
          <button type="button" className="btn btn-primary" onClick={save} disabled={submitting}>
            {submitting ? <Icon name="loader-circle" size={16} className="spin" /> : "Salvar"}
          </button>
        </div>
      </div>
    </DialogModal>
  );
}
