import Link from "next/link";
import {
  CheckCircleIcon,
  CircleIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Accordion } from "@/components/ui/accordion";
import { InfoHint } from "@/components/ui/tooltip";
import {
  type RemovalRequirementCheck,
  type RemovalRequirementKey,
} from "@/lib/certification/readiness";
import { certificationSettingsHref } from "@/lib/certification/links";

interface SubmissionChecksProps {
  checks: RemovalRequirementCheck[];
  facilityId: string;
}

function fixLinkFor(
  key: RemovalRequirementKey,
  facilityId: string,
): { label: string; href: string } | null {
  switch (key) {
    case "mapping":
    case "template":
      return {
        label: "Open settings",
        href: certificationSettingsHref(facilityId),
      };
    case "credentials":
    case "production":
    case "entityReadiness":
    case "evidence":
      return null;
    case "transportUniformity":
    case "transport":
      return {
        label: "Review transport",
        href: `/deliveries?facility=${facilityId}`,
      };
    case "durability":
      return {
        label: "Review samples",
        href: `/samples?facility=${facilityId}`,
      };
  }
}

function CheckIcon({ status }: Pick<RemovalRequirementCheck, "status">) {
  if (status === "met") {
    return (
      <CheckCircleIcon
        size={14}
        weight="fill"
        aria-hidden
        className="shrink-0 text-[var(--color-signal-green)]"
      />
    );
  }
  if (status === "unmet" || status === "warning") {
    return (
      <WarningIcon
        size={14}
        weight="fill"
        aria-hidden
        className="shrink-0 text-[var(--color-signal-orange-strong)]"
      />
    );
  }
  return (
    <CircleIcon
      size={14}
      aria-hidden
      className="shrink-0 text-[var(--color-text-tertiary)]"
    />
  );
}

function CompactCheckRow({
  check,
  facilityId,
}: {
  check: RemovalRequirementCheck;
  facilityId: string;
}) {
  const fix =
    check.status === "unmet" ? fixLinkFor(check.key, facilityId) : null;
  return (
    <li className="flex items-start gap-8 border-t border-[var(--color-border-tertiary)] px-12 py-4 first:border-t-0">
      <span className="mt-2">
        <CheckIcon status={check.status} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="inline-flex items-center gap-4 body-caption font-medium text-[var(--color-text-secondary)]">
          {check.requirementLabel}
          {check.whyDetail && (
            <InfoHint label="Why is this required?">
              {check.whyDetail}
            </InfoHint>
          )}
        </span>
        {check.detail && check.status !== "met" && (
          <span className="body-caption text-[var(--color-text-tertiary)]">
            {check.detail}
          </span>
        )}
        {fix && (
          <Link
            href={fix.href}
            className="self-start body-caption font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline"
          >
            {fix.label}
          </Link>
        )}
      </div>
    </li>
  );
}

export function SubmissionChecks({
  checks,
  facilityId,
}: SubmissionChecksProps) {
  const passedCount = checks.filter((check) => check.status === "met").length;
  const unmetCount = checks.filter((check) => check.status === "unmet").length;
  const warningCount = checks.filter(
    (check) => check.status === "warning",
  ).length;
  const attentionCount = unmetCount + warningCount;
  const summary =
    attentionCount === 0
      ? `${passedCount} of ${checks.length} checks passed`
      : `${passedCount} of ${checks.length} checks passed · ${attentionCount} need attention`;

  return (
    <Accordion.Root
      className="gap-0"
      defaultValue={attentionCount > 0 ? ["submission-checks"] : []}
    >
      <Accordion.Item
        value="submission-checks"
        className="rounded-none border-[var(--color-border-secondary)]"
      >
        <Accordion.Header>
          <Accordion.Trigger
            className="bg-[var(--color-background-white)] px-12 py-8 hover:bg-[var(--color-surface-light)]"
            labelClassName="body-caption normal-case tracking-normal"
          >
            Submission checks · {summary}
          </Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel className="[&>div]:p-0">
          <ul>
            {checks.map((check) => (
              <CompactCheckRow
                key={check.key}
                check={check}
                facilityId={facilityId}
              />
            ))}
          </ul>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion.Root>
  );
}
