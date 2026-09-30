import { WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { Accordion } from "@/components/ui/accordion";
import type { GhgStatementCreateOutcome } from "@/fn/certification/ghg-statements";
import { formatCount } from "@/lib/copy-utils";
import {
  CERTIFICATION_ACCORDION_ITEM,
  CERTIFICATION_ACCORDION_LABEL,
  CERTIFICATION_ACCORDION_TRIGGER,
} from "./certification-accordion-styles";
import { Notice } from "@/components/ui/notice";

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
  // Resolving to an existing statement is informational, not a success, so it
  // is an info Notice rather than a success one.
  return (
    <div className="flex flex-col gap-16">
      <Notice
        tone={alreadyExisted ? "info" : "success"}
        title={
          alreadyExisted
            ? "Statement synced successfully"
            : "Statement created successfully"
        }
      >
        <p>
          {alreadyExisted
            ? `The existing statement has ${formatCount(linkedCount, "linked Removal")}.`
            : `${formatCount(linkedCount, "Removal")} linked from this reporting period.`}
        </p>
        <p className="mt-8 body-caption break-all font-mono text-[var(--color-text-primary)]">
          Registry ID {externalId}
        </p>
      </Notice>
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
              <p className="body-caption px-16 py-10 text-[var(--color-text-secondary)]">
                The statement is saved. These linked Removals need attention in
                noma.
              </p>
              <ul className="flex max-h-[280px] flex-col gap-6 overflow-y-auto pb-10">
                {warnings.map((warning, index) => (
                  <li
                    key={`${index}-${warning}`}
                    className="body-caption px-16 text-[var(--color-text-secondary)]"
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
