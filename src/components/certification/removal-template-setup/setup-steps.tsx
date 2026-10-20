/**
 * The three steps of Removal template setup: pick the template, decide what
 * noma cannot, apply. Presentational: the page owns every choice.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { ChoiceCardGroup } from "@/components/forms";
import { Notice } from "@/components/ui/notice";
import { LedgerBeforeAfter } from "@/components/storage-locations/stock-ledger";
import type { useRemovalTemplateSetup } from "@/hooks/use-removal-template-setup";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { creditBatchListHref } from "@/lib/certification/batch-health-links";
import { formatCount, MISSING_VALUE } from "@/lib/copy-utils";
import {
  type Answers,
  assignmentFill,
  blockedCopy,
  decisionQuestion,
  decisionSituation,
  entryCount,
  optionDescription,
  optionLabel,
  takenOptionIds,
  toDecideLabel,
} from "@/lib/certification/removal-template-setup-copy";
import type { SetupDecision, SetupDefault } from "@/lib/certification/removal-template-setup-plan";

export type SetupData = NonNullable<ReturnType<typeof useRemovalTemplateSetup>["data"]>;
export type SetupTemplate = SetupData["fitting"][number];

const TAKEN_NOTE = "Already used by another component.";
const SELECT_CLASS =
  "h-40 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-12 body-small sm:w-[280px]";

/* Template ----------------------------------------------------------------- */

function notOfferedLine(notFitting: SetupData["notFitting"]): string {
  const items = notFitting.map(({ name, reason }) => `${name} (${reason.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase())})`);
  return `Not offered: ${items.join("; ")}.`;
}

export function TemplateStep({ data, templateId, onChange, invalid }: {
  data: SetupData;
  templateId: string | null;
  onChange: (id: string) => void;
  invalid: boolean;
}) {
  const only = data.fitting.length === 1 ? data.fitting[0] : null;
  const describe = (template: SetupTemplate) => template.blockedReason
    ? blockedCopy(template.blockedReason)
    : `${formatCount(template.componentCount, "component")}. ${toDecideLabel(template.plan.decisions.length)}.`;
  return (
    <div className="flex flex-col gap-16">
      {only ? (
        <div className="flex flex-col gap-4 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-12 py-10">
          <span className="body-small font-medium text-[var(--color-text-primary)]">{only.name}</span>
          <span className="body-caption text-[var(--color-text-tertiary)]">{describe(only)}</span>
        </div>
      ) : (
        <ChoiceCardGroup
          legend="Removal template"
          value={templateId}
          onValueChange={onChange}
          error={invalid && !templateId}
          options={data.fitting.map((template) => ({ value: template.id, title: template.name, description: describe(template), disabled: !!template.blockedReason }))}
        />
      )}
      <p className="body-caption text-[var(--color-text-tertiary)]">
        {only
          ? `The only template in ${data.projectName ?? "this project"} that fits this facility.`
          : `${data.fitting.length} templates in ${data.projectName ?? "this project"} fit this facility.`}
        {data.notFitting.length > 0 && ` ${notOfferedLine(data.notFitting)}`}
      </p>
    </div>
  );
}

/* Decisions ---------------------------------------------------------------- */

/** A quiet disclosure, closed by default: nothing in it needs a click. */
function Disclosure({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-12 border-t border-[var(--color-border-tertiary)] pt-12">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-44 w-full cursor-pointer items-center justify-between gap-12 text-left"
      >
        <span className="body-small font-medium text-[var(--color-text-primary)]">{title}</span>
        <CaretDownIcon size={16} aria-hidden className={cn("shrink-0 text-[var(--color-text-tertiary)] transition-transform", open && "rotate-180")} />
      </button>
      {open && <div id={id}>{children}</div>}
    </div>
  );
}

function DecisionBlock({ decision, number, value, taken, invalid, onChange }: {
  decision: SetupDecision;
  number: number;
  value: string | undefined;
  taken: ReadonlySet<string>;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const question = decisionQuestion(decision);
  const headingId = `decision-${decision.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-12">
      <div className="flex flex-col gap-4">
        <h3 id={headingId} className="body-medium font-medium text-[var(--color-text-primary)]">
          <span className="text-[var(--color-text-tertiary)]">{`${number}. `}</span>
          {question}
        </h3>
        <p className="body-small text-[var(--color-text-secondary)]">{decisionSituation(decision)}</p>
      </div>
      <ChoiceCardGroup
        legend={question}
        value={value ?? null}
        onValueChange={onChange}
        error={invalid && !value}
        stackNarrow
        options={decision.options.map((option) => ({
          value: option.id,
          title: optionLabel(option),
          description: `${optionDescription(decision, option)}${taken.has(option.id) ? ` ${TAKEN_NOTE}` : ""}`,
          disabled: taken.has(option.id),
        }))}
      />
    </section>
  );
}

function DefaultRow({ line, value, taken, onChange }: {
  line: SetupDefault;
  value: string;
  taken: ReadonlySet<string>;
  onChange: (value: string) => void;
}) {
  const name = line.component.displayName;
  const current = line.options.find((option) => option.id === value) ?? line.proposal;
  return (
    <li className="flex flex-col gap-6 border-b border-[var(--color-border-tertiary)] py-10 last:border-b-0 sm:flex-row sm:items-center sm:gap-16">
      <span className="body-small min-w-0 flex-1 text-[var(--color-text-primary)]">{name}</span>
      {line.options.length > 1 ? (
        <select
          aria-label={`What fills ${name}`}
          value={current.id}
          onChange={(event) => onChange(event.target.value)}
          className={SELECT_CLASS}
        >
          {line.options.map((option) => (
            <option key={option.id} value={option.id} disabled={taken.has(option.id) && option.id !== current.id}>
              {taken.has(option.id) && option.id !== current.id ? `${optionLabel(option)} (${TAKEN_NOTE.toLowerCase().replace(/\.$/, "")})` : optionLabel(option)}
            </option>
          ))}
        </select>
      ) : (
        <span className="body-small text-[var(--color-text-secondary)] sm:w-[280px]">{optionLabel(current)}</span>
      )}
    </li>
  );
}

function GroupList({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <h4 className="body-small font-medium text-[var(--color-text-primary)]">{title}</h4>
      <ul className="flex flex-col">{children}</ul>
    </div>
  );
}

export function DecisionsStep({ template, answers, overrides, showMissing, onAnswer, onOverride }: {
  template: SetupTemplate;
  answers: Answers;
  overrides: Answers;
  showMissing: boolean;
  onAnswer: (id: string, value: string) => void;
  onOverride: (id: string, value: string) => void;
}) {
  const { plan } = template;
  const defaultRows = plan.defaults.map((line) => {
    const value = overrides[line.component.id] ?? line.proposal.id;
    const option = line.options.find((candidate) => candidate.id === value) ?? line.proposal;
    return { line, value, fromRecords: Object.values(option.assignments).some((assignment) => assignment.automaticSource) };
  });
  const rows = (fromRecords: boolean) => defaultRows.filter((row) => row.fromRecords === fromRecords).map(({ line, value }) => (
    <DefaultRow
      key={line.component.id}
      line={line}
      value={value}
      taken={takenOptionIds(plan, answers, overrides, line.component.id, line.options)}
      onChange={(next) => onOverride(line.component.id, next)}
    />
  ));
  const records = defaultRows.filter((row) => row.fromRecords).length;
  const entries = defaultRows.length - records;
  const total = plan.defaults.length + plan.decided.length;
  return (
    <div className="flex flex-col gap-24">
      {plan.decisions.length === 0 && <Notice tone="success">{`noma decided all ${formatCount(template.componentCount, "component")}.`}</Notice>}
      {plan.decisions.map((decision, index) => (
        <DecisionBlock
          key={decision.id}
          decision={decision}
          number={index + 1}
          value={answers[decision.id]}
          taken={takenOptionIds(plan, answers, overrides, decision.id, decision.options)}
          invalid={showMissing}
          onChange={(value) => onAnswer(decision.id, value)}
        />
      ))}
      {total > 0 && (
        <Disclosure
          id="setup-decided-components"
          title={plan.defaults.length > 0 ? `noma decided ${formatCount(plan.defaults.length, "component")}` : `${formatCount(plan.decided.length, "component")} decided before`}
        >
          <div className="flex flex-col gap-16">
            <p className="body-small text-[var(--color-text-secondary)]">
              Every component counts as Operating, on each credit batch. Decisions apply to every facility that uses this template.
            </p>
            {records > 0 && <GroupList title={`Filled from noma records (${records})`}>{rows(true)}</GroupList>}
            {entries > 0 && <GroupList title={`Emissions entry on each credit batch (${entries})`}>{rows(false)}</GroupList>}
            {plan.decided.length > 0 && (
              <GroupList title={`Decided before (${plan.decided.length}). Read only.`}>
                {plan.decided.map((line) => (
                  <li key={line.component.id} className="flex flex-col gap-2 border-b border-[var(--color-border-tertiary)] py-10 last:border-b-0 sm:flex-row sm:items-center sm:gap-16">
                    <span className="body-small min-w-0 flex-1 text-[var(--color-text-primary)]">{line.component.displayName}</span>
                    <span className="body-small text-[var(--color-text-secondary)] sm:w-[280px]">{assignmentFill(line.contract)}</span>
                  </li>
                ))}
              </GroupList>
            )}
          </div>
        </Disclosure>
      )}
    </div>
  );
}

/* Apply -------------------------------------------------------------------- */

function CodeLinks({ batches, facilityId }: { batches: { id?: string; code: string }[]; facilityId: string }) {
  return (
    <>
      {batches.map((batch, index) => (
        <span key={batch.code}>
          <Link href={batch.id ? creditBatchDeepLinkHref(batch.id, facilityId) : creditBatchListHref(facilityId)} className="underline underline-offset-2">
            {batch.code}
          </Link>
          {index < batches.length - 1 ? ", " : ""}
        </span>
      ))}
    </>
  );
}

function CheckRow({ checked, onChange, title, children }: { checked: boolean; onChange: (value: boolean) => void; title: string; children?: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-12">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-2 h-[18px] w-[18px] shrink-0 cursor-pointer border border-[var(--color-border-primary)] accent-[var(--clr-dark-purple)]"
      />
      <span className="flex flex-col gap-4">
        <span className="body-medium text-[var(--color-text-primary)]">{title}</span>
        {children && <span className="body-caption text-[var(--color-text-tertiary)]">{children}</span>}
      </span>
    </label>
  );
}

export function ApplyStep({ data, template, answers, overrides, makeDefault, setBatches, onMakeDefault, onSetBatches, facilityId, defaultName }: {
  data: SetupData;
  template: SetupTemplate;
  answers: Answers;
  overrides: Answers;
  makeDefault: boolean;
  setBatches: boolean;
  onMakeDefault: (value: boolean) => void;
  onSetBatches: (value: boolean) => void;
  facilityId: string;
  defaultName: string | null;
}) {
  const without = data.batchesWithoutTemplate;
  const entries = entryCount(template.plan, answers, overrides);
  const others = data.batchesOnOtherTemplates;
  return (
    <div className="flex flex-col gap-20">
      <LedgerBeforeAfter
        title={`Default Removal template for ${data.facility.name}`}
        labels={["Now", "After"]}
        before={defaultName ?? MISSING_VALUE.notSet}
        after={makeDefault ? template.name : (defaultName ?? MISSING_VALUE.notSet)}
      />
      <div className="flex flex-col gap-16">
        <CheckRow checked={makeDefault} onChange={onMakeDefault} title="Make it the default for this facility">
          New credit batches start on this template.
        </CheckRow>
        {without.length > 0 && (
          <CheckRow checked={setBatches} onChange={onSetBatches} title={`Also set it on ${formatCount(without.length, "credit batch", "credit batches")} without a template`}>
            <CodeLinks batches={without} facilityId={facilityId} />
          </CheckRow>
        )}
      </div>
      {others.length > 0 && (
        <Notice tone="info">
          <CodeLinks batches={others} facilityId={facilityId} />
          {` ${others.length === 1 ? "keeps" : "keep"} ${others.length === 1 && others[0].templateName ? others[0].templateName : "their templates"}. An Admin can switch ${others.length === 1 ? "it" : "each"} on its credit batch page.`}
        </Notice>
      )}
      <div className="flex flex-col gap-6">
        <h3 className="body-small font-medium text-[var(--color-text-primary)]">What changes</h3>
        <ul className="flex list-disc flex-col gap-4 pl-20 body-small text-[var(--color-text-secondary)]">
          {makeDefault && <li>{`New credit batches start on ${template.name}.`}</li>}
          {setBatches && without.length > 0 && <li>{`${formatCount(without.length, "credit batch", "credit batches")} ${without.length === 1 ? "passes" : "pass"} the Template set check of New Removal.`}</li>}
          <li>{`${formatCount(entries, "component")} ${entries === 1 ? "takes" : "take"} an emissions entry on each credit batch. Emissions lists them as Not recorded until someone records a value or a zero.`}</li>
          <li>{`The component decisions apply to every facility that uses ${template.name}.`}</li>
        </ul>
      </div>
    </div>
  );
}

export function applyLabel(makeDefault: boolean, batchCount: number): string {
  const batches = formatCount(batchCount, "batch", "batches");
  if (makeDefault && batchCount > 0) return `Make default and set on ${batches}`;
  if (makeDefault) return "Make default";
  return batchCount > 0 ? `Set on ${batches}` : "Save decisions";
}
