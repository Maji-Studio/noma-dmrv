/**
 * The setup flow once the template list is loaded: a compact step rail over the
 * step, and a footer. Nothing is stored until Set template.
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
import { facilityCertificationSettingsHref } from "@/lib/certification/links";
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
import { SETUP_GUTTER_CLASS } from "./layout";
import { CheckStep, TemplateStep, type SetupData } from "./setup-steps";
import { PHONE_TOUCH_TARGET } from "@/components/ui/touch-target";

const SET_LABEL = "Set template";
const STEP_TITLES = ["Pick the template", "Check what changes"];
const STEPS: StepFlowStep[] = [
  { key: "template", label: "Template" },
  { key: "check", label: "Check" },
];

export interface RemovalTemplateSetupFlowProps {
  data: SetupData;
  facilityId: string;
  templateId: string | null;
  step: SetupStepKey | null;
  /** Reads the template list again; the dialog then resets the flow. */
  onReload: () => void;
  /** The Apply mutation, owned by the dialog so it can refuse to close while a save is pending. */
  apply: ReturnType<typeof useApplyRemovalTemplateSetup>;
  /** Closes the dialog, after Apply or on Cancel. */
  onClose: () => void;
}

interface ApplyError { message: string; stale: boolean }

export function RemovalTemplateSetupFlow({ data: loadedData, facilityId, templateId: requestedTemplate, step: requestedStep, onReload, apply, onClose }: RemovalTemplateSetupFlowProps) {
  // The draft keeps the read it started from (fingerprints, batch versions) until an explicit reload remounts the flow.
  const [data] = useState(loadedData);
  const toast = useToast();
  const latched = useLatchedSubmit();
  const start = startState({ fitting: data.fitting, templateId: requestedTemplate, step: requestedStep });
  const [templateId, setTemplateId] = useState(start.templateId);
  const [step, setStep] = useState(start.stepIndex);
  const [furthest, setFurthest] = useState(start.stepIndex);
  const [answers, setAnswers] = useState<Answers>({});
  const [showMissing, setShowMissing] = useState(false);
  const [error, setError] = useState<ApplyError | null>(null);

  const template = data.fitting.find((candidate) => candidate.id === templateId) ?? null;
  const open = template ? openDecisions(template.plan, answers) : [];
  const allBlocked = data.fitting.every((candidate) => candidate.blockedReason);

  const go = (next: number) => {
    setStep(next);
    setFurthest((value) => Math.max(value, next));
    setShowMissing(false);
    setError(null);
  };
  const pickTemplate = (id: string) => {
    setTemplateId(id);
    setAnswers({});
    setFurthest(0);
    setShowMissing(false);
  };

  const submit = async () => {
    if (!template) return;
    if (open.length > 0) {
      setShowMissing(true);
      return;
    }
    setError(null);
    try {
      await apply.mutateAsync({
        facilityId,
        removalTemplateId: template.id,
        fingerprints: { semanticFingerprint: template.semanticFingerprint, fullFingerprint: template.fullFingerprint },
        planFingerprint: template.planFingerprint,
        answers,
        overrides: {},
        // The read the flow started from; the server checks each version, it is not a selector.
        batchVersions: data.batchVersions,
      });
      toast.success(`${template.name} is set.`);
      onClose();
    } catch (caught) {
      setError({
        message: caught instanceof Error ? caught.message : "The template was not set. Try again.",
        stale: !!getStaleVersionConflict(caught),
      });
    }
  };

  const back = () => go(0);

  const next = () => {
    if (!template) setShowMissing(true);
    else go(1);
  };

  const setTemplate = latched(async () => submit());

  return (
    <>
      <div className={`${SETUP_GUTTER_CLASS} pb-16`}>
        <StepFlow steps={STEPS} current={step} furthest={furthest} onNavigate={go} footer={null} className="gap-20">
          <div className="flex flex-col gap-20">
            <h3 className="sr-only">{STEP_TITLES[step]}</h3>
            {step === 0 && <TemplateStep data={data} templateId={templateId} onChange={pickTemplate} invalid={showMissing} notOffered={notOfferedReason(data, requestedTemplate)} facilitySettingsHref={facilityCertificationSettingsHref(facilityId)} />}
            {step === 1 && template && (
              <CheckStep
                data={data}
                template={template}
                answers={answers}
                showMissing={showMissing}
                onAnswer={(id, value) => setAnswers({ ...answers, [id]: value })}
                facilityId={facilityId}
              />
            )}
          </div>
        </StepFlow>
      </div>

      <div ref={reserveStickyFooterSpace} className={`sticky bottom-0 z-10 flex flex-col gap-12 border-t border-[var(--color-border-secondary)] bg-[var(--color-background-white)] ${SETUP_GUTTER_CLASS} py-12`}>
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
        <div className="flex flex-wrap items-center gap-12">
          {step === 0 ? (
            <Button variant="primary" disabled={allBlocked} className={PHONE_TOUCH_TARGET} onClick={next}>Next</Button>
          ) : (
            // Only Set template writes, so only it is latched; the latch holds until the save settles.
            <Button variant="primary" busy={apply.isPending} className={PHONE_TOUCH_TARGET} onClick={() => void setTemplate({ preventDefault: () => undefined })}>
              {SET_LABEL}
            </Button>
          )}
          {step > 0 && <Button className={PHONE_TOUCH_TARGET} variant="weak" disabled={apply.isPending} onClick={back}>Back</Button>}
          <Button className={PHONE_TOUCH_TARGET} variant="weak" disabled={apply.isPending} onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </>
  );
}
