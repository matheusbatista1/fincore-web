"use client";

import { type ReactNode, useId, useState } from "react";
import {
  createCreditCardAction,
  deleteCreditCardAction,
  updateCreditCardAction,
} from "@/app/_actions/finance";
import type { CardView } from "@/application/use-cases/get-workspace-view";
import type { CardFlag } from "@/domain/entities/credit-card";
import { CreditCardWidget } from "@/presentation/components/ui/credit-card-widget";
import { Dialog, DialogTrigger } from "@/presentation/components/ui/dialog";
import { FormModal } from "@/presentation/components/ui/form-modal";
import { toast } from "@/presentation/stores/ui-store";
import { reaisToCents } from "@/shared/formatting/parse-reais";
import { BANK_THEME_TILES, THEME_LABEL } from "@/shared/theme/bank-themes";

const FLAGS: ReadonlyArray<{ value: CardFlag; label: string }> = [
  { value: "mastercard", label: "Mastercard" },
  { value: "visa", label: "Visa" },
  { value: "elo", label: "Elo" },
  { value: "amex", label: "Amex" },
  { value: "hipercard", label: "Hipercard" },
  { value: "other", label: "Outra" },
];

/** Parse a 1–31 day from a text input (empty → fallback). */
function parseDay(value: string, fallback: number): number {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : fallback;
}

/** Novo/editar cartão — ported 1:1 from the prototype (forms.jsx CardForm). */
export function CreditCardFormDialog({
  card,
  holder,
  trigger,
}: {
  card?: CardView;
  holder?: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const formId = useId();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && <CardForm key={formId} card={card} holder={holder} onDone={() => setOpen(false)} />}
    </Dialog>
  );
}

function CardForm({
  card,
  holder,
  onDone,
}: {
  card?: CardView | undefined;
  holder?: string | undefined;
  onDone: () => void;
}) {
  const editing = card !== undefined;
  const [bank, setBank] = useState(card?.bank ?? "");
  const [product, setProduct] = useState(card?.product ?? "");
  const [theme, setTheme] = useState(card?.themeKey || "nubank");
  const [flag, setFlag] = useState<CardFlag>(card?.flag ?? "mastercard");
  const [num, setNum] = useState(card ? card.maskedNumber.replace(/\D/g, "").slice(-4) : "");
  const [limit, setLimit] = useState(card ? (card.limitCents / 100).toFixed(2).replace(".", ",") : "");
  const [closing, setClosing] = useState(card ? String(card.closingDay) : "");
  const [due, setDue] = useState(card ? String(card.dueDay) : "");
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = bank.trim().length > 0 && product.trim().length > 0 && reaisToCents(limit) > 0;
  const maskedPreview = `•••• ${(num || "0000").padStart(4, "0").slice(-4)}`;

  function pickBank(id: string) {
    setTheme(id);
    if (!bank) setBank(THEME_LABEL[id] ?? "");
  }

  async function save() {
    if (!canSubmit || submitting) return;
    setServerError(null);
    const input = {
      bank: bank.trim(),
      product: product.trim(),
      flag,
      themeKey: theme,
      maskedNumber: maskedPreview,
      limitCents: reaisToCents(limit),
      closingDay: parseDay(closing, 3),
      dueDay: parseDay(due, 10),
    };
    setSubmitting(true);
    const result = editing
      ? await updateCreditCardAction(card.id, input)
      : await createCreditCardAction(input);
    setSubmitting(false);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast(`Cartão ${bank.trim()} salvo`);
    onDone();
  }

  async function remove() {
    if (!editing || submitting) return;
    setSubmitting(true);
    const result = await deleteCreditCardAction(card.id);
    setSubmitting(false);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast(`Cartão ${card.bank} removido`);
    onDone();
  }

  return (
    <FormModal
      title={editing ? "Editar cartão" : "Novo cartão"}
      submitLabel={editing ? "Salvar" : "Adicionar"}
      canSubmit={canSubmit}
      submitting={submitting}
      onSubmit={save}
      {...(editing ? { onDelete: remove } : {})}
    >
      {/* preview */}
      <div style={{ maxWidth: 300, margin: "0 auto 22px" }}>
        <CreditCardWidget
          bank={bank || "Banco"}
          product={product || "Produto"}
          flag={flag}
          themeKey={theme}
          maskedNumber={maskedPreview}
          {...(holder ? { holder } : {})}
        />
      </div>

      <div className="field">
        <label>Tema do banco</label>
        <div className="theme-tiles">
          {BANK_THEME_TILES.map((t) => (
            <button
              type="button"
              key={t.id}
              className={`theme-tile${theme === t.id ? " on" : ""}`}
              style={{ background: t.bg }}
              onClick={() => pickBank(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="form-grid-2" style={{ marginBottom: 18 }}>
        <div className="field">
          <label>Banco</label>
          <input
            className="input"
            value={bank}
            onChange={(e) => setBank(e.target.value)}
            placeholder="Nubank"
          />
        </div>
        <div className="field">
          <label>Produto</label>
          <input
            className="input"
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            placeholder="Ultravioleta"
          />
        </div>
      </div>
      <div className="form-grid-2" style={{ marginBottom: 18 }}>
        <div className="field">
          <label>Bandeira</label>
          <select
            className="input"
            aria-label="Bandeira"
            value={flag}
            onChange={(e) => setFlag(e.target.value as CardFlag)}
          >
            {FLAGS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Final do cartão</label>
          <input
            className="input"
            inputMode="numeric"
            maxLength={4}
            value={num}
            onChange={(e) => setNum(e.target.value.replace(/\D/g, ""))}
            placeholder="4821"
          />
        </div>
      </div>
      <div className="form-grid-2" style={{ marginBottom: 18 }}>
        <div className="field">
          <label>Limite (R$)</label>
          <input
            className="input tnum"
            inputMode="decimal"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder="12000"
          />
        </div>
        <div className="field">
          <label>
            Fatura atual <span style={{ color: "var(--text-lo)", fontWeight: 400 }}>· derivada</span>
          </label>
          <div
            className="input tnum"
            style={{ display: "flex", alignItems: "center", color: "var(--text-lo)" }}
          >
            calculada dos lançamentos
          </div>
        </div>
      </div>
      <div className="form-grid-2">
        <div className="field">
          <label>Fecha em (dia)</label>
          <input
            className="input tnum"
            inputMode="numeric"
            maxLength={2}
            value={closing}
            onChange={(e) => setClosing(e.target.value.replace(/\D/g, ""))}
            placeholder="3"
          />
        </div>
        <div className="field">
          <label>Vence em (dia)</label>
          <input
            className="input tnum"
            inputMode="numeric"
            maxLength={2}
            value={due}
            onChange={(e) => setDue(e.target.value.replace(/\D/g, ""))}
            placeholder="10"
          />
        </div>
      </div>
      {serverError && (
        <div className="warn-text" style={{ marginTop: 12 }}>
          {serverError}
        </div>
      )}
    </FormModal>
  );
}
