import { loadWallets } from "@/app/_loaders/wallets";
import { requireDemo } from "@/infrastructure/demo/demo-flag";
import { DEMO_USER_ID, demoRepository } from "@/infrastructure/demo/demo-repository";
import { WalletsShell } from "@/presentation/components/wallets/wallets-shell";
import { todayInBrazil } from "@/shared/formatting/now";

/** The real Carteiras screen (both tabs), loaded the real way, over the made-up household. */
export default async function DemoWallets({
  searchParams,
}: {
  searchParams: Promise<{ m?: string | string[]; tab?: string | string[] }>;
}) {
  requireDemo();
  const props = await loadWallets(demoRepository(todayInBrazil()), DEMO_USER_ID, await searchParams, {
    basePath: "/demo/wallets",
    email: "",
  });
  return <WalletsShell {...props} />;
}
