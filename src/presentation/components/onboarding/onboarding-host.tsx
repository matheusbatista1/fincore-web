"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { markOnboardedAction, updateModulesAction } from "@/app/_actions/auth";
import { TourOverlay } from "@/presentation/components/onboarding/tour-overlay";
import { WelcomeWizard } from "@/presentation/components/onboarding/welcome-wizard";
import { useOnboardingStore } from "@/presentation/stores/onboarding-store";
import type { ModuleKey } from "@/shared/modules";

/**
 * Drives first-run onboarding: shows the welcome wizard when the account hasn't
 * been onboarded yet (or when re-opened from Settings), then the guided tour.
 * Mounted once in the app shell.
 */
export function OnboardingHost({
  onboarded,
  enabledModules,
}: {
  onboarded: boolean;
  enabledModules: ModuleKey[];
}) {
  const router = useRouter();
  const wizardOpen = useOnboardingStore((s) => s.wizardOpen);
  const closeWizard = useOnboardingStore((s) => s.closeWizard);
  const startTour = useOnboardingStore((s) => s.startTour);
  // Once the first-run wizard is completed we dismiss it locally (the persisted
  // flag only flips after the server refresh propagates).
  const [dismissed, setDismissed] = useState(false);

  const firstRun = !onboarded && !dismissed;
  const open = firstRun || wizardOpen;

  async function onFinish(modules: ModuleKey[]) {
    if (!onboarded) {
      setDismissed(true);
      await markOnboardedAction({ modules });
      router.refresh();
      startTour();
    } else {
      await updateModulesAction({ modules });
      closeWizard();
      router.refresh();
    }
  }

  return (
    <>
      {open && (
        <WelcomeWizard
          firstRun={!onboarded}
          initialModules={enabledModules}
          onFinish={onFinish}
          onCancel={closeWizard}
        />
      )}
      <TourOverlay />
    </>
  );
}
