"use client";

import { type ReactNode, useState } from "react";
import { settlePersonAction } from "@/app/_actions/finance";
import { Button } from "@/presentation/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/presentation/components/ui/dialog";
import { cn } from "@/presentation/lib/cn";
import { toast } from "@/presentation/stores/ui-store";
import { formatBRL } from "@/shared/formatting/currency";
import { settlementInputSchema } from "@/shared/schemas/transaction";

interface SettleAccount {
  readonly id: string;
  readonly bank: string;
  readonly name: string;
}

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const fieldClass =
  "h-11 w-full rounded-sm border border-line bg-surface-3 px-3 text-text-hi outline-none transition placeholder:text-text-faint focus:border-purple-400";
const labelClass = "mb-2 block text-xs font-semibold uppercase tracking-wider text-text-lo";

export function SettlePersonDialog({
  person,
  accounts,
  trigger,
}: {
  person: { id: string; name: string; balanceCents: number };
  accounts: SettleAccount[];
  trigger: ReactNode;
}) {
  const owesYou = person.balanceCents > 0;
  const max = Math.abs(person.balanceCents);
  const firstName = person.name.split(" ")[0] ?? person.name;

  const [open, setOpen] = useState(false);
  const [cents, setCents] = useState(max);
  const [ymd, setYmd] = useState(todayIso());
  const [acctId, setAcctId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setCents(max);
    setYmd(todayIso());
    setAcctId(null);
    setNote("");
    setError(null);
  }

  async function submit() {
    if (cents <= 0 || submitting) return;
    setError(null);
    const payload = {
      personId: person.id,
      amountCents: cents,
      date: ymd,
      accountId: acctId,
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const parsed = settlementInputSchema.safeParse(payload);
    if (!parsed.success) {
      setError("Revise os campos do acerto.");
      return;
    }
    setSubmitting(true);
    const result = await settlePersonAction(parsed.data);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast("Acerto registrado.");
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title={`Acertar com ${firstName}`}
        description={
          owesYou
            ? `${firstName} te deve ${formatBRL(max, { withSign: false })}. Registre o quanto recebeu.`
            : `Você deve ${formatBRL(max, { withSign: false })} a ${firstName}. Registre o quanto pagou.`
        }
      >
        <div className="flex flex-col gap-4">
          <label className="block">
            <span className="sr-only">Valor</span>
            <input
              value={formatBRL(cents, { withSign: false })}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "");
                setCents(digits ? Number.parseInt(digits, 10) : 0);
              }}
              inputMode="numeric"
              className={cn(
                "w-full bg-transparent text-center font-display text-4xl font-semibold tabular-nums outline-none",
                owesYou ? "text-mint-500" : "text-rose-500",
              )}
            />
          </label>

          {cents > max && (
            <p className="-mt-2 text-center text-xs text-amber-500">
              Acima do saldo — o restante vira crédito a favor de {firstName}.
            </p>
          )}

          <label className="block">
            <span className={labelClass}>Data</span>
            <input
              type="date"
              value={ymd}
              onChange={(e) => setYmd(e.target.value || todayIso())}
              className={fieldClass}
            />
          </label>

          {accounts.length > 0 && (
            <div>
              <span className={labelClass}>
                {owesYou ? "Caiu em qual carteira?" : "Saiu de qual carteira?"}{" "}
                <span className="font-normal text-text-lo">· opcional</span>
              </span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setAcctId(null)}
                  className={cn(
                    "rounded-pill border px-3 py-2 text-sm font-medium transition",
                    !acctId
                      ? "border-purple-400 bg-purple-soft text-text-hi"
                      : "border-line bg-surface-2 text-text-mid hover:text-text-hi",
                  )}
                >
                  Sem carteira
                </button>
                {accounts.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAcctId(a.id)}
                    className={cn(
                      "rounded-pill border px-3 py-2 text-sm font-medium transition",
                      acctId === a.id
                        ? "border-purple-400 bg-purple-soft text-text-hi"
                        : "border-line bg-surface-2 text-text-mid hover:text-text-hi",
                    )}
                  >
                    {a.bank} · {a.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="block">
            <span className={labelClass}>
              Observação <span className="font-normal text-text-lo">· opcional</span>
            </span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex.: Pix, dinheiro, parcial…"
              className={fieldClass}
            />
          </label>

          {error && <p className="text-sm text-rose-500">{error}</p>}

          <div className="mt-1 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Cancelar</Button>
            </DialogClose>
            <Button onClick={submit} disabled={cents <= 0 || submitting}>
              {submitting ? "Registrando…" : "Registrar acerto"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
