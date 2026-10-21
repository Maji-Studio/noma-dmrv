/**
 * The three steps of Removal template setup: pick the template, decide what
 * noma cannot, apply. Presentational: the setup flow owns every choice.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { ChoiceCardGroup, FormSelect } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { InfoHint } from "@/components/ui/tooltip";
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
/** One width for what fills each component, so the rows line up. */
const FILL_COLUMN_CLASS = "sm:w-[280px]";

/* Template ----------------------------------------------------------------- */

const NOT_FITTING_BADGE = "Does not fit";
const NOT_READY_BADGE = "Not ready";

export function TemplateStep({ data, templateId, onChange, invalid, notOffered, facilitySettingsHref }: {
  data: SetupData;
  templateId: string | null;
  onChange: (id: string) => void;
  invalid: boolean;
  /** Why the template a link named is not in this project. */
  notOffered: string | null;
  facilitySettingsHref: string;
}) {
  const describe = (template: SetupTemplate) => template.blockedReason
    ? blockedCopy(template.blockedReason)
    : `${formatCount(template.componentCount, "component")}. ${toDecideLabel(template.plan.decisions.length)}.`;
  const project = data.projectName ?? "this project";
  // Every Removal template in the project is listed; the ones that do not fit stay disabled with their reason.
  const options = [
    ...data.fitting.map((template) => ({ value: template.id, title: template.name, description: describe(template), disabled: !!template.blockedReason, badge: template.blockedReason ? NOT_READY_BADGE : undefined })),
    ...data.notFitting.map((template) => ({ value: template.id, title: template.name, description: template.reason, disabled: true, badge: NOT_FITTING_BADGE })),
  ];
  return (
    <div className="flex flex-col gap-16">
      {notOffered && <Notice tone="warning">{notOffered}</Notice>}
      {data.fitting.length === 0 && (
        <Notice
          tone="warning"
          action={<Link href={facilitySettingsHref} className="body-small underline underline-offset-2">Open Facilities</Link>}
        >
          {`No Removal template in ${project} fits this facility. Check the facility's durability tier or add a template in Isometric.`}
        </Notice>
      )}
      {options.length > 0 && (
        <ChoiceCardGroup
          legend="Removal template"
          value={templateId}
          onValueChange={onChange}
          error={invalid && !templateId}
          options={options}
        />
      )}
    </div>
  );
}

/* Decisions ---------------------------------------------------------------- */

/** A quiet disclosure, closed by default: nothing in it needs a click. */
function Disclosure({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-12 border-t border-[var(--color-border-tertiary)] pt-12">
      <Button
        variant="noOutline"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="min-h-44 w-full justify-between gap-12 whitespace-normal text-left"
      >
        <span>{title}</span>
        <CaretDownIcon size={16} aria-hidden className={cn("shrink-0 text-[var(--color-text-tertiary)] transition-transform", open && "rotate-180")} />
      </Button>
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
        <FormSelect
          aria-label={`What fills ${name}`}
          value={current.id}
          onChange={(event) => onChange(event.target.value)}
          className={FILL_COLUMN_CLASS}
          options={line.options.map((option) => {
            const blocked = taken.has(option.id) && option.id !== current.id;
            return { value: option.id, label: blocked ? `${optionLabel(option)} (${TAKEN_NOTE.toLowerCase().replace(/\.$/, "")})` : optionLabel(option), disabled: blocked };
          })}
        />
      ) : (
        <span className={cn("body-small text-[var(--color-text-secondary)]", FILL_COLUMN_CLASS)}>{optionLabel(current)}</span>
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
      {plan.decisions.length === 0 && <Notice tone="info">{`noma decided all ${formatCount(template.componentCount, "component")}.`}</Notice>}
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
              These count as Operating, on each credit batch. Change one only if it is wrong for you.
            </p>
            {records > 0 && <GroupList title={`Filled from noma records (${records})`}>{rows(true)}</GroupList>}
            {entries > 0 && <GroupList title={`Emissions entry on each credit batch (${entries})`}>{rows(false)}</GroupList>}
            {plan.decided.length > 0 && (
              <GroupList title={`Decided before (${plan.decided.length}). Decided for every facility using this template.`}>
                {plan.decided.map((line) => (
                  <li key={line.component.id} className="flex flex-col gap-2 border-b border-[var(--color-border-tertiary)] py-10 last:border-b-0 sm:flex-row sm:items-center sm:gap-16">
                    <span className="body-small min-w-0 flex-1 text-[var(--color-text-primary)]">{line.component.displayName}</span>
                    <span className={cn("body-small text-[var(--color-text-secondary)]", FILL_COLUMN_CLASS)}>{assignmentFill(line.contract)}</span>
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
  const isCurrentDefault = template.id === data.defaultRemovalTemplateId;
  return (
    <div className="flex flex-col gap-20">
      {!isCurrentDefault && (
        <>
          <LedgerBeforeAfter
            title={`Default Removal template for ${data.facility.name}`}
            labels={["Now", "After"]}
            before={defaultName ?? MISSING_VALUE.notSet}
            after={makeDefault ? template.name : (defaultName ?? MISSING_VALUE.notSet)}
          />
          <CheckRow checked={makeDefault} onChange={onMakeDefault} title="Make it the default for this facility">
            New credit batches start on this template.
          </CheckRow>
        </>
      )}
      {without.length > 0 && (
        <CheckRow checked={setBatches} onChange={onSetBatches} title={`Also set it on ${formatCount(without.length, "credit batch", "credit batches")} without a template`}>
          <CodeLinks batches={without} facilityId={facilityId} />
        </CheckRow>
      )}
      {others.length > 0 && (
        <Notice tone="info">
          <CodeLinks batches={others} facilityId={facilityId} />
          {` ${others.length === 1 ? "keeps" : "keep"} ${others.length === 1 && others[0].templateName ? others[0].templateName : "their templates"}. An Admin can switch ${others.length === 1 ? "it" : "each"} on its credit batch page.`}
        </Notice>
      )}
      <p className="body-small text-[var(--color-text-secondary)]">
        {`${formatCount(entries, "component")} ${entries === 1 ? "takes" : "take"} an emissions entry on each credit batch. The component decisions apply to every facility that uses ${template.name}.`}
        <InfoHint label="What changes" className="ml-4">
          Emissions lists them as Not recorded until someone records a value or a zero.
        </InfoHint>
      </p>
    </div>
  );
}

export function applyLabel(makeDefault: boolean, batchCount: number): string {
  const batches = formatCount(batchCount, "credit batch", "credit batches");
  if (makeDefault && batchCount > 0) return `Make default and set on ${batches}`;
  if (makeDefault) return "Make default";
  return batchCount > 0 ? `Set on ${batches}` : "Save decisions";
}
