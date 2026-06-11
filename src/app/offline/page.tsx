import { WifiOff } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="relative z-10 grid min-h-dvh place-items-center px-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-surface-2 text-text-lo">
          <WifiOff size={28} />
        </div>
        <h1 className="font-display text-2xl font-semibold text-text-hi">Você está offline</h1>
        <p className="mt-2 text-text-mid">
          Não foi possível carregar esta página. Verifique sua conexão — as páginas já visitadas continuam
          disponíveis offline.
        </p>
      </div>
    </main>
  );
}
