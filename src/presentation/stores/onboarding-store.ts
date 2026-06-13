import { create } from "zustand";

/**
 * First-run onboarding UI state: the welcome wizard (module picker) and the
 * guided coachmark tour. Both can be re-triggered from Settings. The persisted
 * "already onboarded" flag lives on the user row — this store only drives the UI.
 */
interface OnboardingState {
  /** The welcome wizard is open (first run, or re-opened from settings). */
  readonly wizardOpen: boolean;
  /** The guided tour is running. */
  readonly tourActive: boolean;
  /** Current tour step index (into the visible-steps list). */
  readonly step: number;
  openWizard: () => void;
  closeWizard: () => void;
  startTour: () => void;
  endTour: () => void;
  setStep: (step: number) => void;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  wizardOpen: false,
  tourActive: false,
  step: 0,
  openWizard: () => set({ wizardOpen: true }),
  closeWizard: () => set({ wizardOpen: false }),
  startTour: () => set({ tourActive: true, step: 0 }),
  endTour: () => set({ tourActive: false, step: 0 }),
  setStep: (step) => set({ step }),
}));
