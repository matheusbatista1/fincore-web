"use client";

import { type ReactNode, useId, useState } from "react";
import { createAccountAction, deleteAccountAction, updateAccountAction } from "@/app/_actions/finance";
import type { AccountView } from "@/application/use-cases/get-workspace-view";
import { Dialog, DialogTrigger } from "@/presentation/components/ui/dialog";
import { FormModal } from "@/presentation/components/ui/form-modal";
import { toast } from "@/presentation/stores/ui-store";
import { formatBRLAbsolute } from "@/shared/formatting/currency";
import { reaisToCents } from "@/shared/formatting/parse-reais";
import { BANK_THEME_TILES, THEME_LABEL } from "@/shared/theme/bank-themes";

/** Nova/editar carteira — ported 1:1 from the prototype (forms.jsx AccountForm). */
export function AccountFormDialog({ account, trigger }: { account?: AccountView; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const formId = useId();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && <AccountForm key={formId} account={account} onDone={() => setOpen(false)} />}
    </Dialog>
  );
}

function AccountForm({ account, onDone }: { account?: AccountView | undefined; onDone: () => void }) {
  const editing = account !== undefined;
  const [bank, setBank] = useState(account?.bank ?? "");
  const [name, setName] = useState(account?.name ?? "");
  const [theme, setTheme] = useState(account?.themeKey || "nubank");
  const [type, setType] = useState<"PF" | "PJ">(account?.type ?? "PF");
  const [balance, setBalance] = useState(
    account ? (account.openingBalanceCents / 100).toFixed(2).replace(".", ",") : "",
  );
  const [num, setNum] = useState(account ? account.maskedNumber.replace(/\D/g, "").slice(-4) : "");
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = bank.trim().length > 0 && name.trim().length > 0;
  const previewCents = editing ? account.balanceCents : reaisToCents(balance);

  function pickBank(id: string) {
    setTheme(id);
    if (!bank) setBank(THEME_LABEL[id] ?? "");
  }

  async function save() {
    if (!canSubmit || submitting) return;
    setServerError(null);
    const input = {
      bank: bank.trim(),
      name: name.trim(),
      type,
      themeKey: theme,
      openingBalanceCents: reaisToCents(balance),
      maskedNumber: `•• ${(num || "0000").padStart(4, "0").slice(-4)}`,
    };
    setSubmitting(true);
    const result = editing ? await updateAccountAction(account.id, input) : await createAccountAction(input);
    setSubmitting(false);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast(`Carteira ${bank.trim()} salva`);
    onDone();
  }

  async function remove() {
    if (!editing || submitting) return;
    setSubmitting(true);
    const result = await deleteAccountAction(account.id);
    setSubmitting(false);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast(`Carteira ${account.bank} removida`);
    onDone();
  }

  return (
    <FormModal
      title={editing ? "Editar carteira" : "Nova carteira"}
      submitLabel={editing ? "Salvar" : "Adicionar"}
      canSubmit={canSubmit}
      submitting={submitting}
      onSubmit={save}
      {...(editing ? { onDelete: remove } : {})}
    >
      {/* preview */}
      <div className={`cc ${theme}`} style={{ aspectRatio: "1.9/1", maxWidth: 320, margin: "0 auto 22px" }}>
        <div className="cc-top">
          <div className="cc-bank">{bank || "Banco"}</div>
          <span
            className="cc-flag"
            style={{ background: "rgba(255,255,255,0.16)", padding: "3px 8px", borderRadius: 999 }}
          >
            {type}
          </span>
        </div>
        <div>
          <div style={{ fontSize: 11.5, opacity: 0.75, marginBottom: 3 }}>
            {name || "Conta"} · {`•• ${(num || "0000").slice(-4)}`}
          </div>
          <div className="tnum" style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 24 }}>
            {formatBRLAbsolute(previewCents)}
          </div>
        </div>
      </div>

      <div className="field">
        <label>Banco / instituição</label>
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
      <div className="form-grid-2" style={{ margin: "18px 0" }}>
        <div className="field">
          <label>Nome do banco</label>
          <input
            className="input"
            value={bank}
            onChange={(e) => setBank(e.target.value)}
            placeholder="Nubank"
          />
        </div>
        <div className="field">
          <label>Apelido da conta</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Conta principal"
          />
        </div>
      </div>
      <div className="form-grid-2">
        <div className="field">
          <label>Tipo</label>
          <select
            className="input"
            aria-label="Tipo"
            value={type}
            onChange={(e) => setType(e.target.value as "PF" | "PJ")}
          >
            <option value="PF">Pessoa Física</option>
            <option value="PJ">Pessoa Jurídica</option>
          </select>
        </div>
        <div className="field">
          <label>
            Saldo inicial (R$){" "}
            <span style={{ color: "var(--text-lo)", fontWeight: 400 }}>· o atual é derivado</span>
          </label>
          <input
            className="input tnum"
            inputMode="decimal"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            placeholder="0,00"
          />
        </div>
      </div>
      <div className="field" style={{ marginTop: 18, marginBottom: 0 }}>
        <label>Final da conta</label>
        <input
          className="input"
          inputMode="numeric"
          maxLength={4}
          value={num}
          onChange={(e) => setNum(e.target.value.replace(/\D/g, ""))}
          placeholder="4821"
        />
      </div>
      {serverError && (
        <div className="warn-text" style={{ marginTop: 12 }}>
          {serverError}
        </div>
      )}
    </FormModal>
  );
}
