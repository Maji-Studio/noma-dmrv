/**
 * The setup flow once the template list is loaded: a step rail on the left,
 * the step in the middle, a What happens aside. Nothing is stored until Apply.
 * Owner and Admin only; the route redirects Members to the Settings summary.
 */
"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FormActions } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { StepFlow, type StepFlowStep } from "@/components/ui/step-flow";
import { useToast } from "@/components/ui/toast";
import { useLatchedSubmit } from "@/hooks/use-latched-submit";
import { useApplyRemovalTemplateSetup } from "@/hooks/use-removal-template-setup";
import { certificationRemovalTemplatesHref, certificationSettingsHref } from "@/lib/certification/links";
import { formatCount, MISSING_VALUE } from "@/lib/copy-utils";
import { getStaleVersionConflict } from "@/lib/stale-version";
import {
  type Answers,
  answerSummary,
  decisionQuestion,
  notOfferedReason,
  entryCount,
  openDecisions,
  startState,
  toDecideLabel,
  type SetupStepKey,
} from "@/lib/certification/removal-template-setup-copy";
import { ApplyStep, applyLabel, DecisionsStep, TemplateStep, type SetupData } from "./setup-steps";

const APPLY_BUTTON_CLASS = "h-auto min-h-[40px] whitespace-normal py-8 text-left";
const STEP_TITLES = ["Pick the template", "Decide what noma cannot", "Apply the setup"];

export interface RemovalTemplateSetupFlowProps {
  data: SetupData;
  facilityId: string;
  templateId: string | null;
  step: SetupStepKey | null;
  makeDefault: boolean;
  /** Reads the template list again; the page then resets the flow. */
  onReload: () => void;
}

interface ApplyError { message: string; stale: boolean }

export function RemovalTemplateSetupFlow({ data: loadedData, facilityId, templateId: requestedTemplate, step: requestedStep, makeDefault: initialMakeDefault, onReload }: RemovalTemplateSetupFlowProps) {
  // The draft keeps the read it started from (fingerprints, batch versions) until an explicit reload remounts the flow.
  const [data] = useState(loadedData);
  const router = useRouter();
  const toast = useToast();
  const latched = useLatchedSubmit();
  const apply = useApplyRemovalTemplateSetup();
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

  const steps: StepFlowStep[] = [
    { key: "template", label: "Template", description: data.fitting.length === 1 ? "Only one fits" : (template?.name ?? "Pick one") },
    { key: "decisions", label: "Decisions", description: !template ? "After the template" : decisionCount === 0 ? "Nothing to decide" : `${decisionCount - open.length} of ${decisionCount} decided` },
    { key: "apply", label: "Apply", description: "Default and credit batches" },
  ];

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
      router.push(certificationRemovalTemplatesHref(facilityId));
    } catch (caught) {
      setError({
        message: caught instanceof Error ? caught.message : "The template was not set up. Try again.",
        stale: !!getStaleVersionConflict(caught),
      });
    }
  };

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

  return (
    <div className="grid gap-24 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <section className="border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)] p-20 sm:p-24">
        <StepFlow
          steps={steps}
          current={step}
          furthest={furthest}
          onNavigate={go}
          orientation="vertical"
          footer={
            <div className="flex flex-col gap-16">
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
              <FormActions
                sticky={false}
                submitType="button"
                submitLabel={step === 2 ? applyLabel(effectiveMakeDefault, batchCount) : "Continue"}
                submittingLabel="Applying…"
                submitClassName={step === 2 ? APPLY_BUTTON_CLASS : undefined}
                isSubmitting={apply.isPending}
                submitDisabled={allBlocked && step === 0}
                // Only Apply writes, so only Apply is latched; the latch holds until the save settles.
                onSubmitClick={() => (step === 2 ? void applyLatched({ preventDefault: () => undefined }) : void next())}
                errorMessage={error?.message}
                errorAction={error?.stale ? <Button size="small" variant="weak" onClick={onReload}>Reload template</Button> : undefined}
              />
            </div>
          }
        >
          <div className="flex flex-col gap-20">
            <h2 className="title-heading-3">{STEP_TITLES[step]}</h2>
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
              <div className="flex flex-col gap-20">
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
              </div>
            )}
          </div>
        </StepFlow>
      </section>

      <aside aria-label="What happens" className="flex flex-col gap-16 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20 lg:sticky lg:top-24">
        <h2 className="body-medium font-medium text-[var(--color-text-primary)]">What happens</h2>
        <dl className="flex flex-col gap-12">
          {whatHappensRows({ template, open: open.length, answers, overrides, makeDefault: effectiveMakeDefault, batchCount, defaultName }).map((row) => (
            <div key={row.label} className="flex flex-col gap-2">
              <dt className="body-caption text-[var(--color-text-tertiary)]">{row.label}</dt>
              <dd className="body-small text-[var(--color-text-primary)]">{row.value}</dd>
            </div>
          ))}
        </dl>
      </aside>
    </div>
  );
}

function whatHappensRows({ template, open, answers, overrides, makeDefault, batchCount, defaultName }: {
  template: SetupData["fitting"][number] | null;
  open: number;
  answers: Answers;
  overrides: Answers;
  makeDefault: boolean;
  batchCount: number;
  defaultName: string | null;
}): { label: string; value: ReactNode }[] {
  if (!template) return [{ label: "Template", value: MISSING_VALUE.notSet }];
  const { plan } = template;
  const answered = plan.decisions.flatMap((decision) => {
    const option = decision.options.find((candidate) => candidate.id === answers[decision.id]);
    return option ? [answerSummary(decision, option)] : [];
  });
  return [
    { label: "Default for this facility", value: makeDefault ? template.name : (defaultName ?? MISSING_VALUE.notSet) },
    {
      label: "Your decisions",
      value: plan.decisions.length === 0 ? MISSING_VALUE.none : (
        <span className="flex flex-col gap-4">
          <span>{`${plan.decisions.length - open} of ${plan.decisions.length}`}</span>
          {answered.map((line) => <span key={line} className="text-[var(--color-text-secondary)]">{line}</span>)}
        </span>
      ),
    },
    { label: "Decided by noma", value: formatCount(plan.defaults.length, "component") },
    { label: "Credit batches set now", value: batchCount === 0 ? MISSING_VALUE.none : String(batchCount) },
    { label: "Entries on each credit batch", value: formatCount(entryCount(plan, answers, overrides), "component") },
  ];
}

