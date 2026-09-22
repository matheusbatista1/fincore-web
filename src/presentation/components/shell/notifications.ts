import { formatBRLAbsolute } from "@/shared/formatting/currency";

/** Serializable inputs the layout gathers for the notifications panel + bell dot. */
export interface NotifData {
  readonly cards: ReadonlyArray<{
    readonly id: string;
    readonly bank: string;
    readonly dueDay: number;
    /** Amount of the bill that comes due on the next dueDay (not the open cycle). */
    readonly dueBillCents: number;
    readonly utilization: number;
  }>;
  readonly debtors: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly relationship: string;
    readonly balanceCents: number;
  }>;
  readonly today: string;
}

export interface NotifItem {
  /** Stable key for read-state tracking (survives re-derivation across renders). */
  readonly id: string;
  readonly ic: string;
  readonly tone: "amber" | "rose" | "mint";
  readonly title: string;
  readonly sub: string;
  readonly href: string;
}

/** Approx. days from `today` (ISO) to the next occurrence of `dueDay` (1–31). */
function daysUntilDue(dueDay: number, today: string): number {
  const day = Number(today.split("-")[2] ?? "1");
  return dueDay >= day ? dueDay - day : 31 - day + dueDay;
}

/** Next occurrence of `dueDay` as "DD/MM" (prototype shows the date, e.g. "vence 10/06"). */
function nextDueLabel(dueDay: number, today: string): string {
  const [, monthStr, dayStr] = today.split("-");
  const day = Number(dayStr ?? "1");
  let month = Number(monthStr ?? "1");
  if (dueDay < day) month = month === 12 ? 1 : month + 1;
  return `${String(dueDay).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
}

/** Derive the notification items — mirrors the prototype (extras.jsx NotificationsPanel). */
export function deriveNotifications(data: NotifData): NotifItem[] {
  const items: NotifItem[] = [];

  const dueSoon = data.cards
    .filter((c) => c.dueBillCents > 0 && daysUntilDue(c.dueDay, data.today) <= 7)
    .sort((a, b) => daysUntilDue(a.dueDay, data.today) - daysUntilDue(b.dueDay, data.today));
  for (const c of dueSoon) {
    items.push({
      id: `due-${c.id}`,
      ic: "calendar-clock",
      tone: "amber",
      title: `Fatura ${c.bank} vence ${nextDueLabel(c.dueDay, data.today)}`,
      sub: formatBRLAbsolute(c.dueBillCents),
      href: "/cards",
    });
  }

  for (const c of data.cards.filter((card) => card.utilization > 0.85)) {
    items.push({
      id: `util-${c.id}`,
      ic: "alert-triangle",
      tone: "rose",
      title: `${c.bank} em ${Math.round(c.utilization * 100)}% do limite`,
      sub: "Risco de bloqueio",
      href: "/cards",
    });
  }

  const debtors = [...data.debtors].sort((a, b) => b.balanceCents - a.balanceCents).slice(0, 3);
  for (const p of debtors) {
    items.push({
      id: `debtor-${p.id}`,
      ic: "hand-coins",
      tone: "mint",
      title: `${p.name.split(" ")[0]} te deve ${formatBRLAbsolute(p.balanceCents)}`,
      sub: p.relationship,
      href: "/people",
    });
  }

  return items;
}
