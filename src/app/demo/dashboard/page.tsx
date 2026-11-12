import { loadDashboard } from "@/app/_loaders/dashboard";
import { requireDemo } from "@/infrastructure/demo/demo-flag";
import { DEMO_USER_ID, demoRepository } from "@/infrastructure/demo/demo-repository";
import { DashboardView } from "@/presentation/components/dashboard/dashboard-view";
import { todayInBrazil } from "@/shared/formatting/now";

/** The real dashboard, loaded the real way, over the made-up household. */
export default async function DemoDashboard({
  searchParams,
}: {
  searchParams: Promise<{ m?: string | string[]; cf?: string | string[] }>;
}) {
  requireDemo();
  const { data } = await loadDashboard(demoRepository(todayInBrazil()), DEMO_USER_ID, await searchParams);
  return <DashboardView data={data} />;
}
