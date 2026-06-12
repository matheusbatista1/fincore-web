import { BootSplash } from "@/presentation/components/ui/boot-splash";

/** Fullscreen boot splash on hard loads (F5) and the post-login transition. */
export default function RootLoading() {
  return <BootSplash label="Preparando sua vida financeira" full />;
}
