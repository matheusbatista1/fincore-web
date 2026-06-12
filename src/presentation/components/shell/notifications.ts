import { formatBRLAbsolute } from "@/shared/formatting/currency";

/** Serializable inputs the layout gathers for the notifications panel + bell dot. */
export interface NotifData {
  readonly cards: ReadonlyArray<{
    readonly id: string;
    readonly bank: string;
    readonly dueDay: number;
    readonly billCents: number;
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

/** Derive the notification items — mirrors the prototype (extras.jsx NotificationsPanel). */
export function deriveNotifications(data: NotifData): NotifItem[] {
  const items: NotifItem[] = [];

  const dueSoon = data.cards
    .filter((c) => c.billCents > 0 && daysUntilDue(c.dueDay, data.today) <= 7)
    .sort((a, b) => daysUntilDue(a.dueDay, data.today) - daysUntilDue(b.dueDay, data.today));
  for (const c of dueSoon) {
    items.push({
      ic: "calendar-clock",
      tone: "amber",
      title: `Fatura ${c.bank} vence dia ${c.dueDay}`,
      sub: formatBRLAbsolute(c.billCents),
      href: "/cards",
    });
  }

  for (const c of data.cards.filter((card) => card.utilization > 0.85)) {
    items.push({
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
      ic: "hand-coins",
      tone: "mint",
      title: `${p.name.split(" ")[0]} te deve ${formatBRLAbsolute(p.balanceCents)}`,
      sub: p.relationship,
      href: "/people",
    });
  }

  return items;
}
