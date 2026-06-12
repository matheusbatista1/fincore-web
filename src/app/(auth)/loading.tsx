import { BootSplash } from "@/presentation/components/ui/boot-splash";

/** Boot splash while the auth screens load. */
export default function AuthLoading() {
  return <BootSplash label="Preparando sua vida financeira" full />;
}
