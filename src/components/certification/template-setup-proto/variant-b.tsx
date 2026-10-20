/**
 * PROTOTYPE (#1276) variant B: a dedicated setup page. A step rail on the
 * left, the step in the middle, and a "What happens" column on the right that
 * fills in as the operator decides. Settings links to it and shows the summary
 * card afterwards.
 */
"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { StepFlow, type StepFlowStep } from "@/components/ui/step-flow";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { entryCount, FACILITY_NAME, plural, recommendedTemplate } from "./data";
import { ProtoSwitcher } from "./switcher";
import {
  APPLY_BUTTON_CLASS,
  applyLabel,
  ApplyStep,
  DecisionBlock,
  DefaultsList,
  Disclosure,
  encodeAnswers,
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

const SETUP_PATH = "/certification/settings/removal-template-setup";
const SETTINGS_PATH = "/certification/settings";

function protoQuery(scenario: string, extra: Record<string, string> = {}): string {
  // Keep `shot=1` across the route change so screenshots stay free of the switcher.
  const shot = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("shot") === "1";
  return new URLSearchParams({ section: "removal-templates", variant: "b", scenario, ...(shot ? { shot: "1" } : {}), ...extra }).toString();
}

/** The Settings pane for variant B: an entry point before, the summary card after. */
export function VariantBPane() {
  const { scenario, done, answers, templateId } = useProtoParams();
  const router = useRouter();
  const template = findTemplate(scenario, templateId);
  const setupHref = (step?: string) =>
    `${SETUP_PATH}?${protoQuery(scenario.key, { template: template.id, ...(step ? { step } : {}), ...(Object.keys(answers).length ? { a: encodeAnswers(answers) } : {}) })}`;
  if (done) {
    return (
      <TemplateSummaryCard
        scenario={scenario}
        template={template}
        answers={filledAnswers(template, answers)}
        onReview={() => router.push(setupHref("decide"))}
        onChange={() => router.push(setupHref("template"))}
      />
    );
  }
  return <SetupEmptyState scenario={scenario} onStart={() => router.push(setupHref())} />;
}

const STEP_KEYS = ["template", "decide", "apply"] as const;

/** The full setup page. */
export function VariantBPage({ initialStep }: { initialStep: string | null }) {
  const { scenario, answers: carried, templateId: carriedTemplate } = useProtoParams();
  const router = useRouter();
  const [templateId, setTemplateId] = useState(carriedTemplate ?? recommendedTemplate(scenario).id);
  const [answers, setAnswers] = useState<Answers>(carried);
  const template = findTemplate(scenario, templateId);
  const zeroPath = scenario.fitting.length === 1 && template.decisions.length === 0;
  const requested = STEP_KEYS.indexOf(initialStep as (typeof STEP_KEYS)[number]);
  const [step, setStep] = useState(requested >= 0 ? requested : zeroPath ? 2 : 0);
  const [furthest, setFurthest] = useState(requested >= 0 ? 2 : zeroPath ? 2 : 0);
  const [showMissing, setShowMissing] = useState(false);
  const [applyToBatches, setApplyToBatches] = useState(true);
  const open = openDecisions(template, answers);

  const steps: StepFlowStep[] = [
    { key: "template", label: "Template", description: scenario.fitting.length === 1 ? "Only one fits" : template.name },
    { key: "decide", label: "Decisions", description: template.decisions.length === 0 ? "Nothing to decide" : `${template.decisions.length - open.length} of ${template.decisions.length} decided` },
    { key: "apply", label: "Apply", description: "Default and batches" },
  ];
  const go = (next: number) => {
    setStep(next);
    setFurthest((value) => Math.max(value, next));
    setShowMissing(false);
  };
  const finish = () =>
    router.push(`${SETTINGS_PATH}?${protoQuery(scenario.key, { state: "done", template: template.id, a: encodeAnswers(filledAnswers(template, answers)) })}`);
  const next = () => {
    if (step === 0) go(template.decisions.length === 0 ? 2 : 1);
    else if (step === 1) {
      if (open.length > 0) setShowMissing(true);
      else go(2);
    } else finish();
  };
  const backHref = `${SETTINGS_PATH}?${protoQuery(scenario.key)}`;

  return (
    <div className="container-max page-shell">
      <div className="flex flex-col gap-20">
        <Link
          href={backHref}
          className="inline-flex min-h-44 items-center gap-6 self-start body-small text-[var(--color-text-secondary)] underline-offset-2 hover:underline"
        >
          <ArrowLeftIcon size={16} aria-hidden />
          Settings
        </Link>
        <PageHeader area="certification" title="Set up Removal template" subtitle={FACILITY_NAME} />
      </div>

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
                {showMissing && open.length > 0 && (
                  <Notice tone="error">{`${toDecideLabel(open.length)}: ${open.map((decision) => decision.question).join(" ")}`}</Notice>
                )}
                <div className="flex flex-wrap items-center gap-12 border-t border-[var(--color-border-secondary)] pt-16">
                  <Button variant="primary" onClick={next} className={APPLY_BUTTON_CLASS}>
                    {step === 2 ? applyLabel(scenario, applyToBatches) : "Continue"}
                  </Button>
                </div>
              </div>
            }
          >
            <div className="flex flex-col gap-20">
              <h2 className="title-heading-3">
                {step === 0 ? "Pick the template" : step === 1 ? "Decide what noma cannot" : "Make it the default"}
              </h2>
              {step === 0 && (
                <TemplatePick
                  scenario={scenario}
                  value={templateId}
                  onChange={(id) => {
                    setTemplateId(id);
                    setFurthest(0);
                  }}
                />
              )}
              {step === 1 && (
                <div className="flex flex-col gap-24">
                  {template.decisions.length === 0 && (
                    <Notice tone="success">{`noma decided all ${template.componentCount} components.`}</Notice>
                  )}
                  {template.decisions.map((decision, index) => (
                    <DecisionBlock
                      key={decision.id}
                      number={index + 1}
                      decision={decision}
                      value={answers[decision.id]}
                      invalid={showMissing}
                      onChange={(value) => setAnswers({ ...answers, [decision.id]: value })}
                    />
                  ))}
                  <Disclosure id="variant-b-defaults" title={nomaDecidedTitle(template)}>
                    <DefaultsList template={template} />
                  </Disclosure>
                </div>
              )}
              {step === 2 && (
                <div className="flex flex-col gap-20">
                  {zeroPath && (
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
            </div>
          </StepFlow>
        </section>

        <WhatHappens
          templateName={template.name}
          decided={template.decisions.length - open.length}
          total={template.decisions.length}
          nomaCount={template.defaults.length}
          entries={entryCount(template, answers)}
          batches={applyToBatches ? scenario.batchesWithoutTemplate.length : 0}
          answers={template.decisions.filter((decision) => answers[decision.id]).map((decision) => decision.answerLabel(answers[decision.id]))}
        />
      </div>
      <ProtoSwitcher />
    </div>
  );
}

function WhatHappens({
  templateName,
  decided,
  total,
  nomaCount,
  entries,
  batches,
  answers,
}: {
  templateName: string;
  decided: number;
  total: number;
  nomaCount: number;
  entries: number;
  batches: number;
  answers: string[];
}) {
  const rows: { label: string; value: ReactNode }[] = [
    { label: "Default for this facility", value: templateName },
    {
      label: "Your decisions",
      value: total === 0 ? MISSING_VALUE.none : (
        <span className="flex flex-col gap-4">
          <span>{`${decided} of ${total}`}</span>
          {answers.map((answer) => <span key={answer} className="text-[var(--color-text-secondary)]">{answer}</span>)}
        </span>
      ),
    },
    { label: "Decided by noma", value: plural(nomaCount, "component", "components") },
    { label: "Credit batches set now", value: batches === 0 ? MISSING_VALUE.none : String(batches) },
    { label: "Entries on each credit batch", value: plural(entries, "component", "components") },
  ];
  return (
    <aside aria-label="What happens" className="flex flex-col gap-16 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20 lg:sticky lg:top-24">
      <h2 className="body-medium font-medium text-[var(--color-text-primary)]">What happens</h2>
      <dl className="flex flex-col gap-12">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col gap-2">
            <dt className="body-caption text-[var(--color-text-tertiary)]">{row.label}</dt>
            <dd className="body-small text-[var(--color-text-primary)]">{row.value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
