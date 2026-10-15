/**
 * One line of a Removal template in the line review: what the line is, where
 * its figure comes from (scope, automatic figure, emissions entries), and for
 * an Owner or Admin the controls to accept a proposal or assign a contract.
 *
 * A line that needs review carries the open-check treatment the credit batch
 * checklist uses (a left rule on the sea wash), so the lines that block a
 * Removal read as a short list among the reviewed ones.
 */
"use client";

import type { ReactNode } from "react";
import { FormField, FormSelect } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { StatusBadge } from "@/components/ui/status-badge";
import { InfoHint } from "@/components/ui/tooltip";
import type { AutomaticSourceId } from "@/lib/isometric/template-observations/catalog-sources";
import type { EntryPolicy } from "@/lib/isometric/template-observations/types";
import { cn } from "@/lib/utils";
import { RawIdentifiers } from "./removal-template-mapping-view";
import {
  ASSIGNABLE_SCOPES,
  canAcceptProposal,
  CHANGE_LABELS,
  ENTRY_POLICY_LABELS,
  ORIGIN_LABELS,
  SCOPE_LABELS,
  SOURCE_LABELS,
  sourceLabel,
  updateAssignment,
  assignmentFromContract,
  type LineAssignment,
  type LineScope,
  type RemovalTemplateReviewLine,
} from "./removal-template-review-model";

const NO_SOURCE_VALUE = "";
const SCOPE_FIELD_LABEL = "Scope";
const SOURCE_FIELD_LABEL = "Automatic figure";
const ENTRIES_FIELD_LABEL = "Emissions entries";

export interface RemovalTemplateLineRowProps {
  line: RemovalTemplateReviewLine;
  /** Field ids must be unique when two templates share a component id. */
  idPrefix: string;
  needsReview: boolean;
  problems: string[];
  /** The line has an input Isometric did not return in full. */
  notFullyRead: boolean;
  /** Show the change badge only when an earlier read exists to compare with. */
  showChange: boolean;
  canManage: boolean;
  draft: LineAssignment | undefined;
  editing: boolean;
  onDraftChange: (draft: LineAssignment | undefined) => void;
  onEditingChange: (editing: boolean) => void;
}

function ContractValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <dt className="body-caption text-[var(--color-text-tertiary)]">{label}</dt>
      <dd className="body-small text-[var(--color-text-primary)]">{children}</dd>
    </div>
  );
}

function withCurrent<T extends string>(choices: readonly T[], current: T | undefined): T[] {
  return current && !choices.includes(current) ? [...choices, current] : [...choices];
}

function ContractEditor({
  line,
  idPrefix,
  value,
  onChange,
}: {
  line: RemovalTemplateReviewLine;
  idPrefix: string;
  value: LineAssignment;
  onChange: (next: LineAssignment) => void;
}) {
  const operating = value.scope === "operating";
  const sources = withCurrent<AutomaticSourceId>(line.catalogCandidates, value.automaticSource);
  const policies = withCurrent<EntryPolicy>(line.allowedEntryPolicies, value.entryPolicy);
  const ids = {
    scope: `${idPrefix}-scope`,
    source: `${idPrefix}-source`,
    entries: `${idPrefix}-entries`,
  };

  return (
    <div className="grid grid-cols-1 gap-12 sm:grid-cols-3">
      <FormField id={ids.scope} label={SCOPE_FIELD_LABEL}>
        <FormSelect
          id={ids.scope}
          value={value.scope === "unassigned" ? "" : value.scope}
          placeholder={value.scope === "unassigned" ? "Choose a scope" : undefined}
          options={ASSIGNABLE_SCOPES.map((scope) => ({ value: scope, label: SCOPE_LABELS[scope] }))}
          onChange={(event) => onChange(updateAssignment(value, {
            scope: (event.target.value || "unassigned") as LineScope,
          }))}
        />
      </FormField>
      <FormField id={ids.source} label={SOURCE_FIELD_LABEL}>
        <FormSelect
          id={ids.source}
          value={value.automaticSource ?? NO_SOURCE_VALUE}
          disabled={!operating || value.entryPolicy === "single" || sources.length === 0}
          options={[
            { value: NO_SOURCE_VALUE, label: "No automatic figure" },
            ...sources.map((source) => ({ value: source, label: SOURCE_LABELS[source] })),
          ]}
          onChange={(event) => onChange(updateAssignment(value, {
            automaticSource: (event.target.value || undefined) as AutomaticSourceId | undefined,
          }))}
        />
      </FormField>
      <FormField id={ids.entries} label={ENTRIES_FIELD_LABEL}>
        <FormSelect
          id={ids.entries}
          value={value.entryPolicy}
          disabled={!operating}
          options={policies.map((policy) => ({ value: policy, label: ENTRY_POLICY_LABELS[policy] }))}
          onChange={(event) => onChange(updateAssignment(value, {
            entryPolicy: event.target.value as EntryPolicy,
          }))}
        />
      </FormField>
    </div>
  );
}

export function RemovalTemplateLineRow({
  line,
  idPrefix,
  needsReview,
  problems,
  notFullyRead,
  showChange,
  canManage,
  draft,
  editing,
  onDraftChange,
  onEditingChange,
}: RemovalTemplateLineRowProps) {
  const { component, contract } = line;
  const shown = draft ?? assignmentFromContract(contract);
  const changeLabel = showChange ? CHANGE_LABELS[line.change] : undefined;
  const name = component.displayName;

  return (
    <li
      className={cn(
        "flex flex-col gap-12 border-l-2 px-16 py-12",
        needsReview && !draft
          ? "border-[var(--st-wait)] bg-[var(--sea)]"
          : "border-transparent",
      )}
      data-needs-review={needsReview || undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-8">
        <div className="flex min-w-0 flex-col gap-2">
          <span className="inline-flex items-center gap-6 body-small font-medium text-[var(--color-text-primary)]">
            {name}
            {component.description && (
              <InfoHint label={`More about ${name}`}>{component.description}</InfoHint>
            )}
          </span>
          <span className="body-caption text-[var(--color-text-tertiary)]">
            {draft ? "Not saved yet" : ORIGIN_LABELS[contract.origin]}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          {draft ? (
            <StatusBadge status="running" label="Not saved" size="small" />
          ) : needsReview ? (
            <StatusBadge status="pending" label="Needs review" size="small" />
          ) : null}
          {changeLabel && <StatusBadge status="draft" label={changeLabel} size="small" />}
        </div>
      </div>

      {editing ? (
        <ContractEditor
          line={line}
          idPrefix={idPrefix}
          value={shown}
          onChange={(next) => onDraftChange(next)}
        />
      ) : (
        <dl className="grid grid-cols-1 gap-x-16 gap-y-8 sm:grid-cols-3">
          <ContractValue label={SCOPE_FIELD_LABEL}>{SCOPE_LABELS[shown.scope]}</ContractValue>
          <ContractValue label={SOURCE_FIELD_LABEL}>{sourceLabel(shown.automaticSource)}</ContractValue>
          <ContractValue label={ENTRIES_FIELD_LABEL}>{ENTRY_POLICY_LABELS[shown.entryPolicy]}</ContractValue>
        </dl>
      )}

      {problems.length > 0 && !draft && (
        <Notice tone="warning">
          {problems.length === 1 ? problems[0] : (
            <ul className="list-disc pl-16">
              {problems.map((problem) => <li key={problem}>{problem}</li>)}
            </ul>
          )}
        </Notice>
      )}
      {notFullyRead && (
        <Notice tone="info">Some inputs on this line could not be read from Isometric.</Notice>
      )}

      {canManage && (
        <div className="flex flex-wrap items-center gap-8">
          {canAcceptProposal(line) && !draft && (
            <Button
              size="small"
              variant="default"
              aria-label={`Accept proposal for ${name}`}
              onClick={() => onDraftChange(assignmentFromContract(contract))}
            >
              Accept proposal
            </Button>
          )}
          <Button
            size="small"
            variant="weak"
            aria-label={`${editing ? "Close" : "Change"} ${name}`}
            aria-expanded={editing}
            onClick={() => onEditingChange(!editing)}
          >
            {editing ? "Close" : "Change"}
          </Button>
          {draft && (
            <Button
              size="small"
              variant="noOutline"
              aria-label={`Undo changes to ${name}`}
              onClick={() => {
                onDraftChange(undefined);
                onEditingChange(false);
              }}
            >
              Undo
            </Button>
          )}
        </div>
      )}

      <RawIdentifiers
        summary="Line details"
        entries={[
          ["Component", component.id],
          ["Blueprint", component.blueprintKey],
          ["Inputs", component.inputs.map((input) => `${input.key} (${input.type})`).join(", ")],
        ]}
      />
    </li>
  );
}
