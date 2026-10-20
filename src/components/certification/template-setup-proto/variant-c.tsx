/**
 * PROTOTYPE (#1276) variant C: one short checklist in the Settings pane.
 * The recommended template is already chosen, the open decisions are the
 * checklist (count at the top, each resolves inline and folds to one line),
 * noma's defaults sit behind one disclosure, and Apply closes the page.
 */
"use client";

import { useState, type ReactNode } from "react";
import { CheckIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/utils";
import { recommendedTemplate, type OpenDecision } from "./data";
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
  TemplatePick,
  TemplateSummaryCard,
  toDecideLabel,
  useProtoParams,
  type Answers,
} from "./shared";

export function VariantC() {
  const { scenario, done: doneParam } = useProtoParams();
  const [templateId, setTemplateId] = useState(recommendedTemplate(scenario).id);
  const [answers, setAnswers] = useState<Answers>({});
  const [done, setDone] = useState(doneParam);
  const [choosingTemplate, setChoosingTemplate] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [applyToBatches, setApplyToBatches] = useState(true);
  const template = findTemplate(scenario, templateId);
  const open = openDecisions(template, answers);

  if (done) {
    return (
      <TemplateSummaryCard
        scenario={scenario}
        template={template}
        answers={filledAnswers(template, answers)}
        onReview={() => setDone(false)}
        onChange={() => {
          setDone(false);
          setChoosingTemplate(true);
        }}
      />
    );
  }

  const apply = () => {
    if (open.length > 0) {
      setShowMissing(true);
      document.getElementById(`check-${open[0].id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setDone(true);
  };

  return (
    <div className="flex flex-col gap-24">
      <div className="flex flex-col gap-4">
        <h3 className="title-heading-3">
          {template.decisions.length === 0 ? "Nothing to decide" : open.length === 0 ? "All decided" : toDecideLabel(open.length)}
        </h3>
        <p className="body-small text-[var(--color-text-secondary)]">
          {template.decisions.length === 0
            ? `noma decided all ${template.componentCount} components of ${template.name}. Make it the default to finish.`
            : open.length === 0
              ? `Make ${template.name} the default to finish.`
              : `Decide what noma cannot, then make ${template.name} the default.`}
        </p>
      </div>

      <ol className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
        <ChecklistItem
          done
          title="Removal template"
          answer={template.name}
          canChange={scenario.fitting.length > 1}
          expanded={choosingTemplate}
          onChange={() => setChoosingTemplate((value) => !value)}
        >
          <TemplatePick
            scenario={scenario}
            value={templateId}
            onChange={(id) => {
              setTemplateId(id);
              setChoosingTemplate(false);
            }}
          />
        </ChecklistItem>
        {template.decisions.map((decision) => (
          <DecisionItem
            key={decision.id}
            decision={decision}
            value={answers[decision.id]}
            expanded={!answers[decision.id] || editing === decision.id}
            invalid={showMissing}
            onEdit={() => setEditing(decision.id)}
            onChange={(value) => {
              setAnswers({ ...answers, [decision.id]: value });
              setEditing(null);
            }}
          />
        ))}
      </ol>

      <Disclosure id="variant-c-defaults" title={nomaDecidedTitle(template)}>
        <DefaultsList template={template} />
      </Disclosure>

      <div className="flex flex-col gap-20 border-t border-[var(--color-border-tertiary)] pt-20">
        <ApplyStep
          scenario={scenario}
          template={template}
          answers={answers}
          applyToBatches={applyToBatches}
          onApplyToBatches={setApplyToBatches}
        />
        {showMissing && open.length > 0 && (
          <Notice tone="error">{`${toDecideLabel(open.length)} above before ${template.name} can be the default.`}</Notice>
        )}
        <div className="flex flex-wrap items-center gap-12">
          <Button variant="primary" onClick={apply} className={APPLY_BUTTON_CLASS}>{applyLabel(scenario, applyToBatches)}</Button>
        </div>
      </div>
    </div>
  );
}

function StatusMark({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-2 flex size-20 shrink-0 items-center justify-center rounded-full border",
        done
          ? "border-[var(--st-ok)] bg-[var(--st-ok)] text-[var(--color-background-white)]"
          : "border-[var(--color-border-primary)]",
      )}
    >
      {done && <CheckIcon size={12} weight="bold" />}
    </span>
  );
}

function ChecklistItem({
  done,
  title,
  answer,
  canChange,
  expanded,
  onChange,
  children,
  id,
}: {
  done: boolean;
  title: string;
  answer?: string;
  canChange: boolean;
  expanded: boolean;
  onChange: () => void;
  children: ReactNode;
  id?: string;
}) {
  return (
    <li id={id} className="flex flex-col gap-16 border-b border-[var(--color-border-tertiary)] px-16 py-16 last:border-b-0 sm:px-20">
      <div className="flex items-start gap-12">
        <StatusMark done={done} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="body-caption text-[var(--color-text-tertiary)]">{title}</span>
          {answer && <span className="body-small text-[var(--color-text-primary)]">{answer}</span>}
        </div>
        {canChange && !expanded && (
          <Button size="small" variant="noOutline" onClick={onChange}>Change</Button>
        )}
      </div>
      {expanded && <div className="sm:pl-32">{children}</div>}
    </li>
  );
}

function DecisionItem({
  decision,
  value,
  expanded,
  invalid,
  onEdit,
  onChange,
}: {
  decision: OpenDecision;
  value: string | undefined;
  expanded: boolean;
  invalid: boolean;
  onEdit: () => void;
  onChange: (value: string) => void;
}) {
  if (!expanded && value) {
    return (
      <ChecklistItem
        id={`check-${decision.id}`}
        done
        title={decision.question}
        answer={decision.answerLabel(value)}
        canChange
        expanded={false}
        onChange={onEdit}
      >
        {null}
      </ChecklistItem>
    );
  }
  return (
    <li id={`check-${decision.id}`} className="flex items-start gap-12 border-b border-[var(--color-border-tertiary)] px-16 py-16 last:border-b-0 sm:px-20">
      <StatusMark done={false} />
      <div className="min-w-0 flex-1">
        <DecisionBlock decision={decision} value={value} invalid={invalid} onChange={onChange} />
      </div>
    </li>
  );
}
