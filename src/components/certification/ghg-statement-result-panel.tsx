import {
  CheckCircleIcon,
  InfoIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Accordion } from "@/components/ui/accordion";
import type { GhgStatementCreateOutcome } from "@/fn/certification/ghg-statements";
import { formatCount } from "@/lib/copy-utils";
import {
  CERTIFICATION_ACCORDION_ITEM,
  CERTIFICATION_ACCORDION_LABEL,
  CERTIFICATION_ACCORDION_TRIGGER,
} from "./certification-accordion-styles";

const RESULT_WARNINGS_ITEM = "result-warnings";

export function ResultPanel({
  outcome,
  externalId,
  linkedCount,
  warnings,
}: {
  outcome: GhgStatementCreateOutcome;
  externalId: string;
  linkedCount: number;
  warnings: string[];
}) {
  // "existing" is the ADR 0004 idempotent path: a statement for this period was
  // already created in Isometric and this attempt resolved to it. Say that,
  // rather than claiming a creation that did not happen.
  const alreadyExisted = outcome === "existing";
  const OutcomeIcon = alreadyExisted ? InfoIcon : CheckCircleIcon;
  // Resolving to an existing statement is informational, not a success, so it
  // takes the status ramp's in-progress step rather than the success one. The
  // ramp is the semantic layer for feedback accents; `--clr-*` is the raw
  // palette and must not be reached for from a component.
  return (
    <div className="flex flex-col gap-16">
      <div
        role="status"
        className={`flex items-start gap-12 border p-16 ${
          alreadyExisted
            ? "border-[var(--st-run-border)] bg-[var(--st-run-bg)]"
            : "border-[var(--st-ok-border)] bg-[var(--st-ok-bg)]"
        }`}
      >
        <OutcomeIcon
          size={24}
          weight="fill"
          aria-hidden
          className={`shrink-0 ${
            alreadyExisted
              ? "text-[var(--st-run)]"
              : "text-[var(--st-ok)]"
          }`}
        />
        <div className="flex min-w-0 flex-col gap-8">
          <div className="flex flex-col gap-2">
            <p className="body-medium font-medium text-[var(--color-text-primary)]">
              {alreadyExisted
                ? "Statement synced successfully"
                : "Statement created successfully"}
            </p>
            <p className="body-small text-[var(--color-text-secondary)]">
              {alreadyExisted
                ? `The existing statement has ${formatCount(linkedCount, "linked Removal")}.`
                : `${formatCount(linkedCount, "Removal")} linked from this reporting period.`}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <span className="label-micro text-[var(--color-text-tertiary)]">
              Registry ID
            </span>
            <span className="body-caption break-all font-mono text-[var(--color-text-primary)]">
              {externalId}
            </span>
          </div>
        </div>
      </div>
      {warnings.length > 0 && (
        <Accordion.Root className="gap-0" defaultValue={[]}>
          <Accordion.Item
            value={RESULT_WARNINGS_ITEM}
            className={CERTIFICATION_ACCORDION_ITEM}
          >
            <Accordion.Header>
              <Accordion.Trigger
                className={CERTIFICATION_ACCORDION_TRIGGER}
                labelClassName={CERTIFICATION_ACCORDION_LABEL}
              >
                <span className="flex w-full items-center justify-between gap-12">
                  <span className="inline-flex items-center gap-8">
                    <WarningIcon
                      size={16}
                      weight="fill"
                      aria-hidden
                      className="shrink-0 text-[var(--color-signal-orange)]"
                    />
                    Review warnings
                  </span>
                  <span className="body-caption font-normal text-[var(--color-signal-orange)]">
                    {formatCount(warnings.length, "warning")}
                  </span>
                </span>
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Panel className="[&>div]:p-0">
              <p className="body-caption border-b border-[var(--color-border-tertiary)] px-16 py-10 text-[var(--color-text-secondary)]">
                The statement is saved. These linked Removals need attention in
                noma.
              </p>
              <ul className="flex max-h-[280px] flex-col overflow-y-auto">
                {warnings.map((warning, index) => (
                  <li
                    key={`${index}-${warning}`}
                    className="body-caption border-b border-[var(--color-border-tertiary)] px-16 py-10 text-[var(--color-text-secondary)] last:border-b-0"
                  >
                    {warning}
                  </li>
                ))}
              </ul>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion.Root>
      )}
    </div>
  );
}
