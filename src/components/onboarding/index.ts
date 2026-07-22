/**
 * Onboarding — first-run setup for a new Owner/Admin.
 *
 * Two surfaces, one shared gate: the first-run wizard (create-once foundation)
 * and the self-clearing getting-started guide (the traceability-spine
 * dashboard takeover). The dashboard mounts them via `useOnboardingGate` +
 * `OnboardingWizard`; the guide/strip/member surfaces render by mode.
 */

export { useOnboardingGate } from "./use-onboarding-gate";
export type {
  OnboardingGate,
  OnboardingMode,
  OnboardingWizardControls,
} from "./use-onboarding-gate";
export { OnboardingWizard } from "./onboarding-wizard";
export { SetupGuide } from "./setup-guide";
export { SetupStrip } from "./setup-strip";
export { SetupInProgressState } from "./setup-in-progress-state";
export { deriveSetupProgress } from "./use-setup-steps";
export type { SetupStep, SetupProgress } from "./use-setup-steps";
