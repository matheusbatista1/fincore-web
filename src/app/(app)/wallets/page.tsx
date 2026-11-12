import { redirect } from "next/navigation";
import { loadWallets } from "@/app/_loaders/wallets";
import { getCurrentUser } from "@/infrastructure/auth/server";
import { financeRepository } from "@/infrastructure/composition";
import { WalletsShell } from "@/presentation/components/wallets/wallets-shell";

export default async function WalletsPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string | string[]; tab?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const props = await loadWallets(financeRepository, user.id, await searchParams, {
    basePath: "/wallets",
    email: user.email ?? "",
  });
  return <WalletsShell {...props} />;
}
