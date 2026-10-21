/**
 * The two steps of Removal template setup: pick the template, then check what
 * changes (questions noma cannot answer first). Presentational: the setup flow
 * owns every choice.
 */
"use client";

import Link from "next/link";
import { ChoiceCardGroup } from "@/components/forms";
import { Notice } from "@/components/ui/notice";
import { InfoHint } from "@/components/ui/tooltip";
import { LedgerBeforeAfter } from "@/components/storage-locations/stock-ledger";
import type { useRemovalTemplateSetup } from "@/hooks/use-removal-template-setup";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { creditBatchListHref } from "@/lib/certification/batch-health-links";
import { formatCount, MISSING_VALUE } from "@/lib/copy-utils";
import {
  type Answers,
  blockedCopy,
  decisionQuestion,
  decisionSituation,
  entryCount,
  keptCopy,
  optionDescription,
  optionLabel,
  NO_SWITCH_COPY,
  switchLead,
  switchTail,
  takenOptionIds,
  toDecideLabel,
} from "@/lib/certification/removal-template-setup-copy";
import type { SetupDecision } from "@/lib/certification/removal-template-setup-plan";

export type SetupData = NonNullable<ReturnType<typeof useRemovalTemplateSetup>["data"]>;
export type SetupTemplate = SetupData["fitting"][number];

const TAKEN_NOTE = "Already used by another component.";

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
          action={<Link href={facilitySettingsHref} className="body-small underline underline-offset-2">Open Settings, Facilities</Link>}
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
          singleColumn
          radioIndicator
        />
      )}
    </div>
  );
}

/* Questions ---------------------------------------------------------------- */

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
        radioIndicator
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

/* Check -------------------------------------------------------------------- */

/** Codes as links, joined "CB-1, CB-2 and CB-3". */
function JoinedCodes({ batches, facilityId }: { batches: { id?: string; code: string }[]; facilityId: string }) {
  return (
    <>
      {batches.map((batch, index) => (
        <span key={batch.code}>
          {index > 0 && (index === batches.length - 1 ? " and " : ", ")}
          <Link href={batch.id ? creditBatchDeepLinkHref(batch.id, facilityId) : creditBatchListHref(facilityId)} className="underline underline-offset-2">
            {batch.code}
          </Link>
        </span>
      ))}
    </>
  );
}

const KEPT_REASONS = ["removalSent", "certified"] as const;

/** Which credit batches switch and which keep their template, in plain words. Archived batches are left out. */
function ImpactLines({ template, facilityId }: { template: SetupTemplate; facilityId: string }) {
  const switching = template.batchesThatSwitch;
  const groups = KEPT_REASONS.map((reason) => ({ reason, batches: template.batchesKept.filter((batch) => batch.reason === reason) }))
    .filter((group) => group.batches.length > 0);
  const hasBatches = switching.length > 0 || groups.length > 0;
  if (!hasBatches) return null;
  return (
    <p className="body-small text-[var(--color-text-secondary)]">
      {switching.length === 0 ? NO_SWITCH_COPY : (
        <>
          {switchLead(switching.length)}
          <JoinedCodes batches={switching} facilityId={facilityId} />
          {switchTail(switching.length)}
        </>
      )}
      {groups.map((group) => (
        <span key={group.reason}>
          {" "}
          <JoinedCodes batches={group.batches} facilityId={facilityId} />
          {keptCopy(group.reason, group.batches.length)}
        </span>
      ))}
    </p>
  );
}

export function CheckStep({ data, template, answers, showMissing, onAnswer, facilityId }: {
  data: SetupData;
  template: SetupTemplate;
  answers: Answers;
  showMissing: boolean;
  onAnswer: (id: string, value: string) => void;
  facilityId: string;
}) {
  const { plan } = template;
  const entries = entryCount(plan, answers, {});
  return (
    <div className="flex flex-col gap-24">
      {plan.decisions.map((decision, index) => (
        <DecisionBlock
          key={decision.id}
          decision={decision}
          number={index + 1}
          value={answers[decision.id]}
          taken={takenOptionIds(plan, answers, {}, decision.id, decision.options)}
          invalid={showMissing}
          onChange={(value) => onAnswer(decision.id, value)}
        />
      ))}
      <LedgerBeforeAfter
        labels={["Removal template now", "After"]}
        before={data.currentTemplateName ?? MISSING_VALUE.notSet}
        after={template.name}
      />
      <ImpactLines template={template} facilityId={facilityId} />
      <p className="body-small text-[var(--color-text-secondary)]">
        {`${formatCount(entries, "component")} ${entries === 1 ? "takes" : "take"} an emissions entry on each credit batch.`}
        <InfoHint label="What changes" className="ml-4">
          Emissions lists them as Not recorded until someone records a value or a zero.
        </InfoHint>
      </p>
    </div>
  );
}
