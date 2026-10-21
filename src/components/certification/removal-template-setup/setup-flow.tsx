/**
 * The setup flow once the template list is loaded: a compact step rail over the
 * step, and a footer with Next, Back and Cancel. Nothing is stored until Apply.
 * Admin only; the Settings card never opens the dialog for a Member.
 */
"use client";

import { useState } from "react";
import { reserveStickyFooterSpace } from "@/components/forms/form-actions";
import { ServerError } from "@/components/forms/server-error";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { StepFlow, type StepFlowStep } from "@/components/ui/step-flow";
import { useToast } from "@/components/ui/toast";
import { useLatchedSubmit } from "@/hooks/use-latched-submit";
import type { useApplyRemovalTemplateSetup } from "@/hooks/use-removal-template-setup";
import { certificationSettingsHref } from "@/lib/certification/links";
import { getStaleVersionConflict } from "@/lib/stale-version";
import {
  type Answers,
  decisionQuestion,
  notOfferedReason,
  openDecisions,
  startState,
  toDecideLabel,
  type SetupStepKey,
} from "@/lib/certification/removal-template-setup-copy";
import { ApplyStep, applyLabel, DecisionsStep, TemplateStep, type SetupData } from "./setup-steps";
import { cn } from "@/lib/utils";
import { PHONE_TOUCH_TARGET } from "@/components/ui/touch-target";

const APPLY_BUTTON_CLASS = "h-auto min-h-[40px] whitespace-normal py-8 text-left";
const STEP_TITLES = ["Pick the template", "Decide what noma cannot", "Apply the setup"];
const STEPS: StepFlowStep[] = [
  { key: "template", label: "Template" },
  { key: "decisions", label: "Decisions" },
  { key: "apply", label: "Apply" },
];
const LAST_STEP = STEPS.length - 1;
/** Horizontal gutter of the dialog body and its footer. */
const GUTTER_CLASS = "px-20";

export interface RemovalTemplateSetupFlowProps {
  data: SetupData;
  facilityId: string;
  templateId: string | null;
  step: SetupStepKey | null;
  makeDefault: boolean;
  /** Reads the template list again; the dialog then resets the flow. */
  onReload: () => void;
  /** The Apply mutation, owned by the dialog so it can refuse to close while a save is pending. */
  apply: ReturnType<typeof useApplyRemovalTemplateSetup>;
  /** Closes the dialog, after Apply or on Cancel. */
  onClose: () => void;
}

interface ApplyError { message: string; stale: boolean }

export function RemovalTemplateSetupFlow({ data: loadedData, facilityId, templateId: requestedTemplate, step: requestedStep, makeDefault: initialMakeDefault, onReload, apply, onClose }: RemovalTemplateSetupFlowProps) {
  // The draft keeps the read it started from (fingerprints, batch versions) until an explicit reload remounts the flow.
  const [data] = useState(loadedData);
  const toast = useToast();
  const latched = useLatchedSubmit();
  const start = startState({ fitting: data.fitting, templateId: requestedTemplate, step: requestedStep });
  const [templateId, setTemplateId] = useState(start.templateId);
  const [step, setStep] = useState(start.stepIndex);
  const [furthest, setFurthest] = useState(start.stepIndex);
  const [answers, setAnswers] = useState<Answers>({});
  const [overrides, setOverrides] = useState<Answers>({});
  const [makeDefault, setMakeDefault] = useState(initialMakeDefault);
  const [setBatches, setSetBatches] = useState(initialMakeDefault);
  const [showMissing, setShowMissing] = useState(false);
  const [error, setError] = useState<ApplyError | null>(null);

  const template = data.fitting.find((candidate) => candidate.id === templateId) ?? null;
  const open = template ? openDecisions(template.plan, answers) : [];
  const decisionCount = template?.plan.decisions.length ?? 0;
  const defaultName = data.fitting.find((candidate) => candidate.id === data.defaultRemovalTemplateId)?.name
    ?? data.notFitting.find((candidate) => candidate.id === data.defaultRemovalTemplateId)?.name ?? null;
  const allBlocked = data.fitting.every((candidate) => candidate.blockedReason);
  const effectiveMakeDefault = makeDefault && template?.id !== data.defaultRemovalTemplateId;
  const batchCount = setBatches ? data.batchesWithoutTemplate.length : 0;

  const go = (next: number) => {
    setStep(next);
    setFurthest((value) => Math.max(value, next));
    setShowMissing(false);
    setError(null);
  };
  const pickTemplate = (id: string) => {
    setTemplateId(id);
    setAnswers({});
    setOverrides({});
    setFurthest(0);
    setShowMissing(false);
  };
  const setOverride = (id: string, value: string) => {
    const line = template?.plan.defaults.find((candidate) => candidate.component.id === id);
    const rest = Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== id));
    setOverrides(line && value === line.proposal.id ? rest : { ...rest, [id]: value });
  };

  const submit = async () => {
    if (!template) return;
    setError(null);
    try {
      await apply.mutateAsync({
        facilityId,
        removalTemplateId: template.id,
        fingerprints: { semanticFingerprint: template.semanticFingerprint, fullFingerprint: template.fullFingerprint },
        planFingerprint: template.planFingerprint,
        answers,
        overrides,
        makeDefault: effectiveMakeDefault,
        batches: setBatches ? data.batchesWithoutTemplate.map(({ id, version }) => ({ id, expectedVersion: version })) : [],
      });
      toast.success(`${template.name} is set up.`);
      onClose();
    } catch (caught) {
      setError({
        message: caught instanceof Error ? caught.message : "The template was not set up. Try again.",
        stale: !!getStaleVersionConflict(caught),
      });
    }
  };

  const back = () => go(step === LAST_STEP && decisionCount === 0 ? 0 : step - 1);

  const next = async () => {
    if (step === 0) {
      if (!template) setShowMissing(true);
      else go(decisionCount === 0 ? 2 : 1);
    } else if (step === 1) {
      if (open.length > 0) setShowMissing(true);
      else go(2);
    } else await submit();
  };

  const applyLatched = latched(async () => submit());
  const decided = decisionCount - open.length;

  return (
    <>
      <div className={`${GUTTER_CLASS} pb-16`}>
        <StepFlow steps={STEPS} current={step} furthest={furthest} onNavigate={go} footer={null} className="gap-20">
          <div className="flex flex-col gap-20">
            <h3 className="sr-only">{STEP_TITLES[step]}</h3>
            {step === 0 && <TemplateStep data={data} templateId={templateId} onChange={pickTemplate} invalid={showMissing} notOffered={notOfferedReason(data, requestedTemplate)} certifierHref={certificationSettingsHref(facilityId)} />}
            {step === 1 && template && (
              <DecisionsStep
                template={template}
                answers={answers}
                overrides={overrides}
                showMissing={showMissing}
                onAnswer={(id, value) => setAnswers({ ...answers, [id]: value })}
                onOverride={setOverride}
              />
            )}
            {step === 2 && template && (
              <ApplyStep
                data={data}
                template={template}
                answers={answers}
                overrides={overrides}
                makeDefault={effectiveMakeDefault}
                setBatches={setBatches}
                onMakeDefault={setMakeDefault}
                onSetBatches={setSetBatches}
                facilityId={facilityId}
                defaultName={defaultName}
              />
            )}
          </div>
        </StepFlow>
      </div>

      <div ref={reserveStickyFooterSpace} className={`sticky bottom-0 z-10 flex flex-col gap-12 border-t border-[var(--color-border-secondary)] bg-[var(--color-background-white)] ${GUTTER_CLASS} py-12`}>
        {allBlocked && step === 0 && (
          <Notice tone="warning">
            {data.fitting.length === 0 ? "No template can be set up yet." : data.fitting.length === 1 ? "This template cannot be set up yet." : "None of these templates can be set up yet."}
            {data.fitting.length > 0 && " Fix what each card says in Isometric, then come back."}
          </Notice>
        )}
        {showMissing && step === 0 && !allBlocked && <Notice tone="error">Pick a template to continue.</Notice>}
        {showMissing && step === 1 && open.length > 0 && (
          <Notice tone="error">{`${toDecideLabel(open.length)}: ${open.map((decision) => decisionQuestion(decision)).join(" ")}`}</Notice>
        )}
        <ServerError
          message={error?.message}
          action={error?.stale ? <Button size="small" variant="weak" onClick={onReload}>Reload template</Button> : undefined}
        />
        <div className="flex flex-wrap items-center justify-start gap-x-16 gap-y-12">
          <div className="flex flex-wrap items-center gap-12">
            <Button
              variant="primary"
              busy={apply.isPending}
              disabled={allBlocked && step === 0}
              className={cn(step === LAST_STEP ? APPLY_BUTTON_CLASS : undefined, PHONE_TOUCH_TARGET)}
              // Only Apply writes, so only Apply is latched; the latch holds until the save settles.
              onClick={() => (step === LAST_STEP ? void applyLatched({ preventDefault: () => undefined }) : void next())}
            >
              {apply.isPending ? "Applying…" : step === LAST_STEP ? applyLabel(effectiveMakeDefault, batchCount) : "Next"}
            </Button>
            {step > 0 && <Button className={PHONE_TOUCH_TARGET} variant="default" disabled={apply.isPending} onClick={back}>Back</Button>}
            <Button className={PHONE_TOUCH_TARGET} variant="default" disabled={apply.isPending} onClick={onClose}>Cancel</Button>
          </div>
          {step === 1 && decisionCount > 0 && (
            <span className="body-caption text-[var(--color-text-tertiary)]">{`${decided} of ${decisionCount} decided`}</span>
          )}
        </div>
      </div>
    </>
  );
}
