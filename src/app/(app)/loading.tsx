import { BootSplash } from "@/presentation/components/ui/boot-splash";

/** Prototype-styled spinner shown instantly while a section's data streams in. */
export default function Loading() {
  return <BootSplash label="Carregando…" />;
}
