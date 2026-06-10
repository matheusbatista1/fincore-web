/**
 * Split (rateio) calculator — distributes a shared expense slice across the user
 * ("você") and a set of selected people, for one per-installment amount (`unit`).
 *
 * Ported faithfully from the prototype's `result` useMemo in
 * `Finance Pessoal/app/split.jsx` (lines ~62-79). Where the prototype rounds Reais
 * with `r2(x) = Math.round(x * 100) / 100`, the equivalent here is integer-cent
 * math through {@link Money} — no floats touch the result.
 *
 * The defining invariant ("remainder placement"):
 *   - In an EQUAL split, every selected person gets `each = unit / partCount`
 *     (rounded). The rounding remainder stays with **você** when the user is
 *     included (`meIn`); when the user is excluded it is absorbed by the **last**
 *     selected person, so the shares still reconcile to `unit`.
 *   - In a CUSTOM split, selected people keep their specified amounts; what is left
 *     over (`unit − Σ`) is the user's share when included, or an "unassigned"
 *     shortfall/overflow that makes the split invalid when the user is excluded.
 */

import { Money } from "../money/money";

/** How the expense is divided among participants. */
export type SplitMethod = "equal" | "custom";

/** Inputs to the split computation. */
export interface SplitInput {
  /**
   * The amount to divide — the per-parcela value (`unit`) in the prototype.
   * Pass the absolute (positive) slice amount; the calculator works on its value.
   */
  readonly unit: Money;
  /** Division method: split evenly ("equal") or per-person amounts ("custom"). */
  readonly method: SplitMethod;
  /** Whether the user ("você") is included in the split. */
  readonly meIn: boolean;
  /**
   * Ordered list of selected person ids. Order matters: in an equal split with the
   * user excluded, the LAST id absorbs the rounding remainder (mirrors the
   * prototype's `selected[selected.length - 1]`).
   */
  readonly selected: readonly string[];
  /**
   * For the "custom" method, the explicit amount each person owes, keyed by person
   * id. A person in `selected` without an entry here is treated as 0 (matching the
   * prototype's `parseFloat(custom[id]) || 0`). Ignored for the "equal" method.
   */
  readonly custom?: ReadonlyMap<string, Money>;
}

/** Result of the split computation — all amounts are {@link Money} (integer cents). */
export interface SplitResult {
  /** Each selected person's share, keyed by person id. */
  readonly shares: ReadonlyMap<string, Money>;
  /** The user's own portion ("você"); zero when the user is excluded. */
  readonly myShare: Money;
  /** Sum of everyone else's shares (Σ of `shares` values). */
  readonly othersTotal: Money;
  /** Whether the split is consistent and submittable. */
  readonly valid: boolean;
  /** Human-readable reason the split is invalid (Portuguese, as in the prototype). */
  readonly warning?: string;
  /** Number of participants: `(meIn ? 1 : 0) + selected.length`. */
  readonly partCount: number;
}

/** Format cents as the prototype's BRLc would render (e.g. 7400 → "R$ 74,00"). */
function brl(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const reais = Math.floor(abs / 100);
  const remainder = (abs % 100).toString().padStart(2, "0");
  const grouped = reais.toLocaleString("pt-BR");
  return `${sign}R$ ${grouped},${remainder}`;
}

/**
 * Compute the split of `unit` across the user and selected people.
 *
 * @see SplitInput / SplitResult for the shape; mirrors `split.jsx`'s `result`.
 */
export function calculateSplit(input: SplitInput): SplitResult {
  const { unit, method, meIn, selected } = input;

  const partCount = (meIn ? 1 : 0) + selected.length;

  // --- Validation that does not depend on the method (prototype lines 65-66). ---
  // unit <= 0  → invalid (no warning text in the prototype, just `valid = false`).
  // partCount === 0 → invalid with a warning.
  let valid = true;
  let warning: string | undefined;
  if (unit.lessThanOrEqual(Money.zero())) {
    valid = false;
  }
  if (partCount === 0) {
    valid = false;
    warning = "Adicione pelo menos uma pessoa ao rateio.";
  }

  const shares = new Map<string, Money>();
  let myShare = Money.zero();

  if (method === "equal") {
    // `each = r2(unit / partCount)` — exact integer-cent division (no float divisor),
    // matching the prototype. partCount === 0 is already invalid above, so guard with zero.
    const each = partCount > 0 ? unit.divide(partCount) : Money.zero();

    for (const id of selected) {
      shares.set(id, each);
    }

    if (meIn) {
      // The rounding remainder stays with "você": myShare = unit − each * |selected|.
      myShare = unit.subtract(each.multiply(selected.length));
    } else {
      // User excluded: myShare = 0 and the LAST selected absorbs the remainder so the
      // shares reconcile to `unit`: last = unit − each * (|selected| − 1).
      myShare = Money.zero();
      if (selected.length > 0) {
        const lastId = selected[selected.length - 1] as string;
        const lastShare = unit.subtract(each.multiply(selected.length - 1));
        shares.set(lastId, lastShare);
      }
    }
  } else {
    // --- Custom method (prototype lines 73-75). ---
    const custom = input.custom ?? new Map<string, Money>();
    let sum = Money.zero();
    for (const id of selected) {
      const value = custom.get(id) ?? Money.zero();
      shares.set(id, value);
      sum = sum.add(value);
    }

    if (meIn) {
      // The leftover is the user's share; over-allocation (sum > unit) is invalid.
      myShare = unit.subtract(sum);
      if (sum.greaterThan(unit)) {
        valid = false;
        warning = `A soma das partes (${brl(sum.cents)}) excede a parcela.`;
      }
    } else {
      // User excluded: the people must cover exactly `unit`. Over → invalid;
      // any positive shortfall (`unassigned > 0`) → invalid.
      myShare = Money.zero();
      const unassigned = unit.subtract(sum);
      if (sum.greaterThan(unit)) {
        valid = false;
        warning = `A soma (${brl(sum.cents)}) excede a parcela.`;
      } else if (unassigned.isPositive()) {
        valid = false;
        warning = `Faltam ${brl(unassigned.cents)} para distribuir.`;
      }
    }
  }

  // othersTotal = Σ of the people's shares (prototype's `Object.values(map).reduce`).
  const othersTotal = Money.sum([...shares.values()]);

  return {
    shares,
    myShare,
    othersTotal,
    valid,
    partCount,
    ...(warning !== undefined ? { warning } : {}),
  };
}
