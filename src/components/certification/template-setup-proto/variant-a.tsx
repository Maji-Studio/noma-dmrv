/**
 * PROTOTYPE (#1276) variant A: a stepper dialog over Settings.
 * Template, then Decisions, then Apply. With one fitting template and nothing
 * to decide it opens on Apply, the first two steps already done.
 */
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { StepFlow, type StepFlowStep } from "@/components/ui/step-flow";
import { recommendedTemplate, plural, FACILITY_NAME } from "./data";
import {
  APPLY_BUTTON_CLASS,
  applyLabel,
  ApplyStep,
  DecisionBlock,
  DefaultsList,
  Disclosure,
  filledAnswers,
  findTemplate,
  nomaDecidedTitle,
  openDecisions,
  SetupEmptyState,
  TemplatePick,
  TemplateSummaryCard,
  toDecideLabel,
  useProtoParams,
  type Answers,
} from "./shared";

const TITLE_ID = "template-setup-title";

export function VariantA() {
  const { scenario, done: doneParam } = useProtoParams();
  const [templateId, setTemplateId] = useState(recommendedTemplate(scenario).id);
  const [answers, setAnswers] = useState<Answers>({});
  const [done, setDone] = useState(doneParam);
  const [open, setOpen] = useState(false);
  const [startStep, setStartStep] = useState(0);
  const template = findTemplate(scenario, templateId);

  const start = (step: number) => {
    setStartStep(step);
    setOpen(true);
  };
  // Nothing to choose and nothing to decide: open on Apply.
  const firstStep = scenario.fitting.length === 1 && recommendedTemplate(scenario).decisions.length === 0 ? 2 : 0;

  return (
    <>
      {done ? (
        <TemplateSummaryCard
          scenario={scenario}
          template={template}
          answers={filledAnswers(template, answers)}
          onReview={() => start(1)}
          onChange={() => start(0)}
        />
      ) : (
        <SetupEmptyState scenario={scenario} onStart={() => start(firstStep)} />
      )}
      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        ariaLabelledBy={TITLE_ID}
        width="lg"
        contentClassName="p-20"
        dismissOnClickOutside={false}
      >
        <SetupDialogBody
          initialStep={startStep}
          templateId={templateId}
          onTemplate={setTemplateId}
          answers={answers}
          onAnswers={setAnswers}
          onCancel={() => setOpen(false)}
          onDone={() => {
            setDone(true);
            setOpen(false);
          }}
        />
      </Modal>
    </>
  );
}

function SetupDialogBody({
  initialStep,
  templateId,
  onTemplate,
  answers,
  onAnswers,
  onCancel,
  onDone,
}: {
  initialStep: number;
  templateId: string;
  onTemplate: (id: string) => void;
  answers: Answers;
  onAnswers: (answers: Answers) => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { scenario } = useProtoParams();
  const template = findTemplate(scenario, templateId);
  const [step, setStep] = useState(initialStep);
  const [furthest, setFurthest] = useState(Math.max(initialStep, template.decisions.length === 0 ? 2 : initialStep));
  const [showMissing, setShowMissing] = useState(false);
  const [applyToBatches, setApplyToBatches] = useState(true);
  const open = openDecisions(template, answers);

  const steps: StepFlowStep[] = [
    { key: "template", label: "Template" },
    { key: "decide", label: "Decisions" },
    { key: "apply", label: "Apply" },
  ];
  const go = (next: number) => {
    setStep(next);
    setFurthest((value) => Math.max(value, next));
    setShowMissing(false);
  };
  const next = () => {
    if (step === 0) go(template.decisions.length === 0 ? 2 : 1);
    else if (step === 1) {
      if (open.length > 0) setShowMissing(true);
      else go(2);
    } else onDone();
  };

  return (
    <div className="flex flex-col gap-20">
      <div className="flex flex-col gap-4 pr-40">
        <h2 id={TITLE_ID} className="title-heading-3">Set up Removal template</h2>
        <p className="body-small text-[var(--color-text-secondary)]">{FACILITY_NAME}</p>
      </div>

      <StepFlow steps={steps} current={step} furthest={furthest} onNavigate={go} footer={null} className="gap-20">
        {step === 0 && (
          <TemplatePick scenario={scenario} value={templateId} onChange={(id) => { onTemplate(id); setFurthest(0); }} />
        )}
        {step === 1 && (
          <div className="flex flex-col gap-24">
            {template.decisions.length === 0 ? (
              <Notice tone="success">{`noma decided all ${template.componentCount} components. Nothing is left for you.`}</Notice>
            ) : (
              <p className="body-small text-[var(--color-text-secondary)]">
                {`noma cannot decide ${plural(template.decisions.length, "thing", "things")} in ${template.name}. Everything else has a default you can change below.`}
              </p>
            )}
            {template.decisions.map((decision, index) => (
              <DecisionBlock
                key={decision.id}
                number={index + 1}
                decision={decision}
                value={answers[decision.id]}
                invalid={showMissing}
                onChange={(value) => onAnswers({ ...answers, [decision.id]: value })}
              />
            ))}
            <Disclosure id="variant-a-defaults" title={nomaDecidedTitle(template)}>
              <DefaultsList template={template} />
            </Disclosure>
          </div>
        )}
        {step === 2 && (
          <div className="flex flex-col gap-20">
            {initialStep === 2 && template.decisions.length === 0 && (
              <Notice tone="success">
                {`${template.name} is the only template that fits, and noma decided all ${template.componentCount} components.`}
              </Notice>
            )}
            <ApplyStep
              scenario={scenario}
              template={template}
              answers={answers}
              applyToBatches={applyToBatches}
              onApplyToBatches={setApplyToBatches}
            />
          </div>
        )}
      </StepFlow>

      {showMissing && open.length > 0 && (
        <Notice tone="error">{`${toDecideLabel(open.length)}: ${open.map((decision) => decision.question).join(" ")}`}</Notice>
      )}

      <div className="flex flex-wrap items-center justify-start gap-x-16 gap-y-12 border-t border-[var(--color-border-secondary)] pt-16">
        <div className="flex items-center gap-12">
          <Button variant="primary" onClick={next} className={APPLY_BUTTON_CLASS}>
            {step === 2 ? applyLabel(scenario, applyToBatches) : "Continue"}
          </Button>
          <Button variant="default" onClick={onCancel}>Cancel</Button>
        </div>
        {step === 1 && template.decisions.length > 0 && (
          <span className="body-caption text-[var(--color-text-tertiary)]">
            {`${template.decisions.length - open.length} of ${template.decisions.length} decided`}
          </span>
        )}
      </div>
    </div>
  );
}
