/**
 * PROTOTYPE (#1276), not for merge. The parts every template setup variant
 * shares: the template pick, one open decision, noma's defaults, the apply
 * step and the summary card Settings shows afterwards.
 */
"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CaretDownIcon, ListChecksIcon } from "@phosphor-icons/react/dist/ssr";
import { ChoiceCardGroup } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { StatusBadge } from "@/components/ui/status-badge";
import { LedgerBeforeAfter } from "@/components/storage-locations/stock-ledger";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { cn } from "@/lib/utils";
import {
  entryCount,
  FACILITY_NAME,
  ORGANIZATION_NAME,
  parseScenario,
  plural,
  recommendedTemplate,
  SCENARIOS,
  type DefaultDecision,
  type OpenDecision,
  type Scenario,
  type TemplateOption,
} from "./data";

const EMPTY_ICON_SIZE = 32;

export type ProtoVariant = "a" | "b" | "c";
export type Answers = Record<string, string>;

export interface ProtoParams {
  variant: ProtoVariant | null;
  scenario: Scenario;
  done: boolean;
  shot: boolean;
  /** Answers carried across a route change (variant B), `id.value~id.value`. */
  answers: Answers;
  templateId: string | null;
}

export function encodeAnswers(answers: Answers): string {
  return Object.entries(answers).map(([id, value]) => `${id}.${value}`).join("~");
}

function decodeAnswers(raw: string | null): Answers {
  if (!raw) return {};
  return Object.fromEntries(raw.split("~").map((pair) => pair.split(".") as [string, string]).filter(([id, value]) => id && value));
}

export function useProtoParams(): ProtoParams {
  const params = useSearchParams();
  const raw = params.get("variant");
  return {
    variant: raw === "a" || raw === "b" || raw === "c" ? raw : null,
    scenario: SCENARIOS[parseScenario(params.get("scenario"))],
    done: params.get("state") === "done",
    shot: params.get("shot") === "1",
    answers: decodeAnswers(params.get("a")),
    templateId: params.get("template"),
  };
}

export function findTemplate(scenario: Scenario, id: string | null | undefined): TemplateOption {
  return scenario.fitting.find((template) => template.id === id) ?? recommendedTemplate(scenario);
}

/** Answers that still match an option of the template's decisions. */
export function openDecisions(template: TemplateOption, answers: Answers): OpenDecision[] {
  return template.decisions.filter((decision) => !decision.options.some((option) => option.value === answers[decision.id]));
}

export function toDecideLabel(count: number): string {
  return count === 0 ? "Nothing to decide" : `${count} to decide`;
}

/* -------------------------------------------------------------------------- */
/* Template pick                                                              */
/* -------------------------------------------------------------------------- */

export function TemplatePick({
  scenario,
  value,
  onChange,
}: {
  scenario: Scenario;
  value: string;
  onChange: (id: string) => void;
}) {
  const recommended = recommendedTemplate(scenario);
  return (
    <div className="flex flex-col gap-16">
      {scenario.fitting.length === 1 ? (
        <div className="flex flex-col gap-4 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-12 py-10">
          <span className="body-small font-medium text-[var(--color-text-primary)]">{recommended.name}</span>
          <span className="body-caption text-[var(--color-text-tertiary)]">
            {`${recommended.componentCount} components. ${toDecideLabel(recommended.decisions.length)}.`}
          </span>
        </div>
      ) : (
        <ChoiceCardGroup
          legend="Removal template"
          value={value}
          onValueChange={onChange}
          options={scenario.fitting.map((template) => ({
            value: template.id,
            title: template.name,
            badge: template.id === recommended.id ? "Recommended" : undefined,
            description: `${template.componentCount} components. ${toDecideLabel(template.decisions.length)}.`,
          }))}
        />
      )}
      <p className="body-caption text-[var(--color-text-tertiary)]">
        {scenario.fitting.length === 1
          ? `The only template in ${scenario.projectName} for ${scenario.durability}.`
          : `${scenario.fitting.length} templates in ${scenario.projectName} fit ${scenario.durability}. noma recommends the one with the fewest decisions left.`}
        {scenario.notFitting.length > 0 && (
          <> {`Not offered: ${scenario.notFitting.map((t) => `${t.name} (${t.reason.toLowerCase()})`).join(", ")}.`}</>
        )}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* One open decision                                                          */
/* -------------------------------------------------------------------------- */

export function DecisionBlock({
  decision,
  value,
  onChange,
  number,
  invalid,
}: {
  decision: OpenDecision;
  value: string | undefined;
  onChange: (value: string) => void;
  number?: number;
  invalid?: boolean;
}) {
  const headingId = `decision-${decision.id}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-12">
      <div className="flex flex-col gap-4">
        <h3 id={headingId} className="body-medium font-medium text-[var(--color-text-primary)]">
          {number !== undefined && <span className="text-[var(--color-text-tertiary)]">{`${number}. `}</span>}
          {decision.question}
        </h3>
        <p className="body-small text-[var(--color-text-secondary)]">{decision.situation}</p>
      </div>
      <ChoiceCardGroup
        legend={decision.question}
        value={value ?? null}
        onValueChange={onChange}
        error={invalid && !value}
        options={decision.options}
      />
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* noma's defaults                                                            */
/* -------------------------------------------------------------------------- */

const ENTRY_LABEL = "Emissions entry on each credit batch";

function DefaultRow({ row }: { row: DefaultDecision }) {
  const [editing, setEditing] = useState(false);
  const [fill, setFill] = useState(row.fill === "records" && row.source ? row.source : ENTRY_LABEL);
  const options = row.source ? [row.source, ENTRY_LABEL] : [ENTRY_LABEL];
  return (
    <li className="flex flex-col gap-6 border-b border-[var(--color-border-tertiary)] py-10 last:border-b-0 sm:flex-row sm:items-center sm:gap-16">
      <span className="body-small min-w-0 flex-1 text-[var(--color-text-primary)]">{row.component}</span>
      {editing ? (
        <select
          aria-label={`What fills ${row.component}`}
          value={fill}
          onChange={(event) => {
            setFill(event.target.value);
            setEditing(false);
          }}
          className="h-40 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-12 body-small sm:w-[280px]"
        >
          {options.map((option) => <option key={option}>{option}</option>)}
        </select>
      ) : (
        <span className="flex items-center gap-12 sm:w-[280px] sm:justify-end">
          <span className="body-small min-w-0 flex-1 text-[var(--color-text-secondary)] sm:text-right">
            {fill === ENTRY_LABEL ? (row.requiredEachBatch ? "Entry, required on every batch" : "Entry") : fill}
          </span>
          {options.length > 1 && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="body-caption min-h-44 shrink-0 underline underline-offset-2 text-[var(--color-text-secondary)] sm:min-h-0"
            >
              Change
            </button>
          )}
        </span>
      )}
    </li>
  );
}

export function DefaultsList({ template }: { template: TemplateOption }) {
  const records = template.defaults.filter((row) => row.fill === "records");
  const entries = template.defaults.filter((row) => row.fill === "entry");
  return (
    <div className="flex flex-col gap-16">
      <p className="body-small text-[var(--color-text-secondary)]">
        Every component counts as Operating, on each credit batch.
      </p>
      <DefaultGroup title={`Filled from noma records (${records.length})`} rows={records} />
      <DefaultGroup title={`${ENTRY_LABEL} (${entries.length})`} rows={entries} />
    </div>
  );
}

function DefaultGroup({ title, rows }: { title: string; rows: DefaultDecision[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col">
      <h4 className="body-small font-medium text-[var(--color-text-primary)]">{title}</h4>
      <ul className="flex flex-col">
        {rows.map((row) => <DefaultRow key={row.component} row={row} />)}
      </ul>
    </div>
  );
}

/** A quiet disclosure. Closed by default: nothing in it needs a click. */
export function Disclosure({
  title,
  children,
  defaultOpen = false,
  id,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  id: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="flex flex-col gap-12 border-t border-[var(--color-border-tertiary)] pt-12">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-44 items-center justify-between gap-12 text-left"
      >
        <span className="body-small font-medium text-[var(--color-text-primary)]">{title}</span>
        <CaretDownIcon
          size={16}
          aria-hidden
          className={cn("shrink-0 text-[var(--color-text-tertiary)] transition-transform", open && "rotate-180")}
        />
      </button>
      {open && <div id={id}>{children}</div>}
    </div>
  );
}

export function nomaDecidedTitle(template: TemplateOption): string {
  return `noma decided ${plural(template.defaults.length, "component", "components")}`;
}

/* -------------------------------------------------------------------------- */
/* Apply                                                                      */
/* -------------------------------------------------------------------------- */

export function batchListHref(): string {
  return "/credit-batches";
}

function BatchLinks({ codes }: { codes: string[] }) {
  return (
    <>
      {codes.map((code, index) => (
        <span key={code}>
          <Link href={batchListHref()} className="underline underline-offset-2">{code}</Link>
          {index < codes.length - 1 ? ", " : ""}
        </span>
      ))}
    </>
  );
}

/** The apply label is long; let it wrap at phone width instead of widening the pane. */
export const APPLY_BUTTON_CLASS = "h-auto min-h-[40px] whitespace-normal py-8 text-left";

export function applyLabel(scenario: Scenario, applyToBatches: boolean): string {
  const count = scenario.batchesWithoutTemplate.length;
  return applyToBatches && count > 0
    ? `Make default and set on ${plural(count, "batch", "batches")}`
    : "Make default";
}

export function ApplyStep({
  scenario,
  template,
  answers,
  applyToBatches,
  onApplyToBatches,
}: {
  scenario: Scenario;
  template: TemplateOption;
  answers: Answers;
  applyToBatches: boolean;
  onApplyToBatches: (value: boolean) => void;
}) {
  const without = scenario.batchesWithoutTemplate;
  const entries = entryCount(template, answers);
  return (
    <div className="flex flex-col gap-20">
      <LedgerBeforeAfter
        title={`Default Removal template for ${FACILITY_NAME}`}
        labels={["Now", "After"]}
        before={MISSING_VALUE.notSet}
        after={template.name}
      />
      {without.length > 0 && (
        <label className="flex cursor-pointer items-start gap-12">
          <input
            type="checkbox"
            checked={applyToBatches}
            onChange={(event) => onApplyToBatches(event.target.checked)}
            className="mt-2 h-[18px] w-[18px] shrink-0 cursor-pointer border border-[var(--color-border-primary)] accent-[var(--clr-dark-purple)]"
          />
          <span className="flex flex-col gap-4">
            <span className="body-medium text-[var(--color-text-primary)]">
              {`Also set it on ${plural(without.length, "credit batch", "credit batches")} without a template`}
            </span>
            <span className="body-caption text-[var(--color-text-tertiary)]">
              <BatchLinks codes={without} />
            </span>
          </span>
        </label>
      )}
      {scenario.batchesWithTemplate.map((batch) => (
        <Notice key={batch.code} tone="info">
          <Link href={batchListHref()} className="underline underline-offset-2">{batch.code}</Link>
          {` keeps ${batch.template}. An Admin can switch it on its credit batch page.`}
        </Notice>
      ))}
      <div className="flex flex-col gap-6">
        <h3 className="body-small font-medium text-[var(--color-text-primary)]">What changes</h3>
        <ul className="flex list-disc flex-col gap-4 pl-20 body-small text-[var(--color-text-secondary)]">
          <li>New credit batches start on {template.name}.</li>
          {applyToBatches && without.length > 0 && (
            <li>{`${without.slice(0, -1).join(", ")}${without.length > 1 ? " and " : ""}${without[without.length - 1]} pass the Template set check of New Removal.`}</li>
          )}
          <li>{`${plural(entries, "component takes", "components take")} an emissions entry on each credit batch. Emissions lists them as Not recorded until someone records a value or a zero.`}</li>
          <li>{`The component decisions apply to every facility in ${ORGANIZATION_NAME} that uses ${template.name}.`}</li>
        </ul>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Settings before and after                                                  */
/* -------------------------------------------------------------------------- */

export function SetupEmptyState({ scenario, onStart, action }: { scenario: Scenario; onStart?: () => void; action?: ReactNode }) {
  const recommended = recommendedTemplate(scenario);
  const description = scenario.fitting.length === 1 && recommended.decisions.length === 0
    ? `${recommended.name} fits this facility and has nothing left to decide. Credit batches need a template before a Removal can be sent.`
    : `${plural(scenario.fitting.length, "template", "templates")} in ${scenario.projectName} fit this facility. The recommended one leaves ${plural(recommended.decisions.length, "decision", "decisions")} for you. Credit batches need a template before a Removal can be sent.`;
  return (
    <EmptyState
      icon={<ListChecksIcon size={EMPTY_ICON_SIZE} weight="bold" />}
      title="No Removal template set"
      description={description}
      padding="sm"
      action={action ?? <Button variant="primary" onClick={onStart}>Set up template</Button>}
    />
  );
}

export function TemplateSummaryCard({
  scenario,
  template,
  answers,
  onReview,
  onChange,
}: {
  scenario: Scenario;
  template: TemplateOption;
  answers: Answers;
  onReview: () => void;
  onChange: () => void;
}) {
  const batchCount = scenario.batchesWithoutTemplate.length;
  const headingId = "template-summary-title";
  return (
    <article aria-labelledby={headingId} className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
      <div className="flex flex-col gap-16 p-20">
        <div className="flex flex-wrap items-center gap-12">
          <h3 id={headingId} className="title-heading-3">{template.name}</h3>
          <StatusBadge status="ready" />
        </div>
        <dl className="grid grid-cols-1 gap-12 sm:grid-cols-[160px_minmax(0,1fr)]">
          <dt className="body-small text-[var(--color-text-tertiary)]">Used by</dt>
          <dd className="body-small text-[var(--color-text-primary)]">
            {`Default for ${FACILITY_NAME}. ${plural(batchCount, "credit batch", "credit batches")}: `}
            <BatchLinks codes={scenario.batchesWithoutTemplate} />
          </dd>
          <dt className="body-small text-[var(--color-text-tertiary)]">Decided by you</dt>
          <dd className="body-small text-[var(--color-text-primary)]">
            {template.decisions.length === 0 ? (
              MISSING_VALUE.none
            ) : (
              <ul className="flex flex-col gap-4">
                {template.decisions.map((decision) => (
                  <li key={decision.id}>{decision.answerLabel(answers[decision.id] ?? decision.options[0].value)}</li>
                ))}
              </ul>
            )}
          </dd>
          <dt className="body-small text-[var(--color-text-tertiary)]">Decided by noma</dt>
          <dd className="body-small text-[var(--color-text-primary)]">
            {plural(template.defaults.length, "component", "components")}
          </dd>
          <dt className="body-small text-[var(--color-text-tertiary)]">Entries per batch</dt>
          <dd className="body-small text-[var(--color-text-primary)]">
            {`${plural(entryCount(template, answers), "component takes", "components take")} an emissions entry on each credit batch`}
          </dd>
        </dl>
      </div>
      <div className="flex flex-wrap items-center gap-12 border-t border-[var(--color-border-tertiary)] px-20 py-12">
        <Button size="small" variant="default" onClick={onReview}>Review decisions</Button>
        <Button size="small" variant="noOutline" onClick={onChange}>Change template</Button>
      </div>
    </article>
  );
}

/** Answers with every open decision filled with its first option, for a direct `state=done` link. */
export function filledAnswers(template: TemplateOption, answers: Answers): Answers {
  return Object.fromEntries(template.decisions.map((decision) => [decision.id, answers[decision.id] ?? decision.options[0].value]));
}
