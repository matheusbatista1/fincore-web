import type { TransactionListItem } from "@/application/use-cases/get-transactions";
import { Avatar } from "@/presentation/components/ui/avatar";

/**
 * Overlapping avatars of the people involved in a lançamento — the split participants of a shared
 * expense, or the payer of an income that is a person's payment. Renders nothing when nobody else is
 * involved. A single reusable badge so every screen (transações, visão mensal, dashboard) shows the
 * same "who's involved" hint.
 */
export function PeopleStack({
  item,
  size = 24,
  max = 3,
}: {
  item: TransactionListItem;
  size?: number;
  max?: number;
}) {
  const people =
    item.shares.length > 0
      ? item.shares.map((s) => ({ id: s.personId, name: s.name, color: s.color }))
      : item.fromPersonId && item.fromPersonName
        ? [{ id: item.fromPersonId, name: item.fromPersonName, color: undefined as string | undefined }]
        : [];
  if (people.length === 0) return null;

  return (
    <div className="row" style={{ flex: "none" }} title={people.map((p) => p.name).join(", ")}>
      {people.slice(0, max).map((p, i) => (
        <span key={p.id} style={{ marginLeft: i ? -8 : 0 }}>
          <Avatar name={p.name} size={size} {...(p.color ? { color: p.color } : {})} />
        </span>
      ))}
      {people.length > max && (
        <span style={{ marginLeft: 4, fontSize: 12, color: "var(--text-lo)", alignSelf: "center" }}>
          +{people.length - max}
        </span>
      )}
    </div>
  );
}
