/**
 * OnboardingWizard — the first-run wizard (Surface 1). A non-dismiss-on-outside
 * Modal wrapping the dumb `StepFlow`: this component owns the active index and
 * gates progression. It captures only the create-once foundation that unblocks
 * the app — facility, reactor, registry — reusing the real entity forms and
 * certification surfaces rather than reimplementing them. Every step is
 * skippable; the dashboard guide walks the rest.
 *
 * Already-satisfied steps never re-run: once a facility (or reactor) exists,
 * its step shows a confirmation instead of the create form, so Back can't
 * spawn a duplicate.
 */
"use client";

import { useState } from "react";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { FacilityForm } from "@/components/facilities/facility-form";
import { ReactorForm } from "@/components/reactors/reactor-form";
import { Button, Modal, StepFlow, type StepFlowStep } from "@/components/ui";
import { useCreateFacility } from "@/hooks/use-facilities";
import { useCreateReactor } from "@/hooks/use-reactors";
import { useFacilityContext } from "@/hooks/use-facility-context";
import type { OnboardingStatus } from "@/data-access/onboarding";
import type { FacilityFormData } from "@/schemas/facilities";
import type { CreateReactorData } from "@/schemas/reactors";
import type { OnboardingWizardControls } from "./use-onboarding-gate";
import { WizardRegistryStep } from "./wizard-registry-step";

const WIZARD_TITLE_ID = "onboarding-wizard-title";

const STEPS: StepFlowStep[] = [
  { key: "welcome", label: "Welcome" },
  { key: "facility", label: "Facility" },
  { key: "reactor", label: "Reactor" },
  { key: "registry", label: "Registry" },
];

const STEP = { welcome: 0, facility: 1, reactor: 2, registry: 3 } as const;

interface OnboardingWizardProps {
  wizard: OnboardingWizardControls;
  status: OnboardingStatus | undefined;
}

export function OnboardingWizard({ wizard, status }: OnboardingWizardProps) {
  const { facilityId, setFacilityId } = useFacilityContext();
  const createFacility = useCreateFacility();
  const createReactor = useCreateReactor();

  const [current, setCurrent] = useState<number>(STEP.welcome);
  const [createdFacilityId, setCreatedFacilityId] = useState<string | null>(
    null,
  );
  const [reactorCreated, setReactorCreated] = useState(false);
  const [facilityError, setFacilityError] = useState("");
  const [reactorError, setReactorError] = useState("");

  const facilityAlreadyExists = (status?.facilityCount ?? 0) > 0;
  const reactorAlreadyExists = (status?.facility?.reactorCount ?? 0) > 0;
  const facilityDone = facilityAlreadyExists || createdFacilityId !== null;
  const reactorDone = reactorAlreadyExists || reactorCreated;
  const activeFacilityId = facilityId ?? createdFacilityId;

  const resetOnOpen = () => {
    // Latch the wizard open so the facility creation that follows can't flip
    // the auto-open derivation and close it mid-flow.
    wizard.latchOpen();
    setCurrent(STEP.welcome);
    setCreatedFacilityId(null);
    setReactorCreated(false);
    setFacilityError("");
    setReactorError("");
  };

  const handleFacilitySubmit = async (data: FacilityFormData) => {
    setFacilityError("");
    try {
      const facility = await createFacility.mutateAsync(data);
      setCreatedFacilityId(facility.id);
      // Make the new facility active so the reactor + registry steps scope to
      // it (ReactorForm reads facilityId from context; the registry surfaces
      // take activeFacilityId). Goes through the context setter, not a
      // hand-rolled localStorage write. The wizard is latched open before the
      // mutation refreshes onboarding status, so this cannot close it mid-flow.
      setFacilityId(facility.id);
      setCurrent(STEP.reactor);
    } catch (error) {
      setFacilityError(
        error instanceof Error ? error.message : "The facility was not created. Check the form and try again.",
      );
    }
  };

  const handleReactorSubmit = async (data: CreateReactorData) => {
    setReactorError("");
    try {
      await createReactor.mutateAsync(data);
      setReactorCreated(true);
      setCurrent(STEP.registry);
    } catch (error) {
      setReactorError(
        error instanceof Error ? error.message : "The reactor was not created. Check the form and try again.",
      );
    }
  };

  return (
    <Modal
      isOpen={wizard.isOpen}
      onClose={wizard.dismiss}
      onOpen={resetOnOpen}
      width="lg"
      ariaLabelledBy={WIZARD_TITLE_ID}
      dismissOnClickOutside={false}
    >
      <div className="flex flex-col gap-24">
        <header className="flex flex-col gap-6">
          <span className="label-micro text-[var(--color-text-tertiary)]">
            Getting started
          </span>
          <h2 id={WIZARD_TITLE_ID} className="title-heading-3">
            Set up your facility
          </h2>
        </header>

        <StepFlow
          steps={STEPS}
          current={current}
          footer={renderFooter()}
        >
          {renderStep()}
        </StepFlow>
      </div>
    </Modal>
  );

  function renderStep() {
    switch (current) {
      case STEP.welcome:
        return <WelcomeStep />;

      case STEP.facility:
        return facilityDone ? (
          <ConfirmationPanel
            title="Facility added"
            description="Your facility is ready. Next, register the reactor that produces its biochar."
          />
        ) : (
          <div className="flex flex-col gap-16">
            <p className="body-small text-[var(--color-text-secondary)]">
              Tell us about the site where you produce biochar.
            </p>
            <FacilityForm
              onSubmit={handleFacilitySubmit}
              onCancel={() => setCurrent(STEP.welcome)}
              isSubmitting={createFacility.isPending}
              errorMessage={facilityError ?? undefined}
              submitLabel="Add facility"
            />
          </div>
        );

      case STEP.reactor:
        if (reactorDone) {
          return (
            <ConfirmationPanel
              title="Reactor registered"
              description="Your reactor is ready. Last step: connect your registry, or skip and do it later."
            />
          );
        }
        return (
          <div className="flex flex-col gap-16">
            <p className="body-small text-[var(--color-text-secondary)]">
              Register the reactor that converts feedstock into biochar at this
              facility.
            </p>
            <ReactorForm
              onSubmit={handleReactorSubmit}
              onCancel={() => setCurrent(STEP.facility)}
              isSubmitting={createReactor.isPending}
              errorMessage={reactorError ?? undefined}
              submitLabel="Register reactor"
            />
          </div>
        );

      case STEP.registry:
        return activeFacilityId ? (
          <WizardRegistryStep
            facilityId={activeFacilityId}
            canManage={status?.isOwnerOrAdmin ?? false}
          />
        ) : (
          <ConfirmationPanel
            title="Add a facility first"
            description="Connect your registry once your facility exists. You can do this later from the dashboard."
          />
        );

      default:
        return null;
    }
  }

  function renderFooter() {
    // Form steps own their action row (the form's submit + Cancel-as-Back), so
    // the wizard footer there is just the always-available skip. Non-form steps
    // get the full Back / Skip / advance row.
    const skip = (
      <Button variant="weak" size="small" onClick={wizard.dismiss}>
        Skip setup
      </Button>
    );

    if (current === STEP.facility && !facilityDone) return skip;
    if (current === STEP.reactor && !reactorDone) return skip;

    return (
      <div className="flex flex-wrap items-center justify-between gap-12">
        <div className="flex items-center gap-12">
          {current > STEP.welcome && (
            <Button
              variant="default"
              size="small"
              onClick={() => setCurrent(current - 1)}
            >
              Back
            </Button>
          )}
          {skip}
        </div>
        {current === STEP.registry ? (
          <Button variant="primary" size="small" onClick={wizard.dismiss}>
            Finish
          </Button>
        ) : (
          <Button
            variant="primary"
            size="small"
            onClick={() => setCurrent(current + 1)}
          >
            {current === STEP.welcome ? "Get started" : "Continue"}
          </Button>
        )}
      </div>
    );
  }
}

function WelcomeStep() {
  return (
    <div className="flex flex-col gap-16">
      <p className="body-medium text-[var(--color-text-primary)]">
        A few steps to get your facility producing verified carbon removals.
      </p>
      <p className="body-small text-[var(--color-text-secondary)]">
        We&apos;ll set up your facility, its first reactor, and your registry
        connection. You can add suppliers, feedstock, production runs, and
        credit batches from the dashboard whenever you&apos;re
        ready.
      </p>
    </div>
  );
}

function ConfirmationPanel({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-12 border border-[var(--color-border-secondary)] bg-[var(--clr-pink-5)] p-16">
      <CheckCircleIcon
        size={24}
        weight="fill"
        className="shrink-0 text-[var(--clr-pink)]"
        aria-hidden
      />
      <div className="flex flex-col gap-4">
        <span className="body-medium font-medium text-[var(--color-text-primary)]">
          {title}
        </span>
        <span className="body-small text-[var(--color-text-secondary)]">
          {description}
        </span>
      </div>
    </div>
  );
}
