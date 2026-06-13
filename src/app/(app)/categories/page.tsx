import { redirect } from "next/navigation";
import { getTransactions } from "@/application/use-cases/get-transactions";
import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { CategoriesView, type CategoryListItem } from "@/presentation/components/categories/categories-view";

export default async function CategoriesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [transactions, workspace] = await Promise.all([
    getTransactions(financeRepository, user.id),
    getWorkspaceView(financeRepository, user.id),
  ]);

  // Per-category usage: how many rows reference it and how much was spent on it.
  const usage = new Map<string, { count: number; totalCents: number }>();
  for (const tx of transactions) {
    if (!tx.categoryId) continue;
    const acc = usage.get(tx.categoryId) ?? { count: 0, totalCents: 0 };
    acc.count += 1;
    if (tx.amountCents < 0) acc.totalCents += Math.abs(tx.amountCents);
    usage.set(tx.categoryId, acc);
  }

  const categories: CategoryListItem[] = workspace.categories
    .map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      icon: c.icon,
      count: usage.get(c.id)?.count ?? 0,
      totalCents: usage.get(c.id)?.totalCents ?? 0,
    }))
    .sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name, "pt-BR"));

  return <CategoriesView categories={categories} />;
}
