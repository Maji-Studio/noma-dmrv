/**
 * RemovalTemplateSummaryCard: the "Removal templates" pane of Certification
 * settings. One card for the template this facility's credit batches use:
 * status, where it is used, how many components were decided and by whom, and
 * how many take an emissions entry. Owners and Admins get Review decisions and
 * Change template, both leading to the setup page; Members read the same card
 * without buttons. Decisions are stored per organization and template, so the
 * caption says they reach every facility using it.
 *
 * Read live from Isometric through the setup read, which stores nothing.
 */
"use client";

import Link from "next/link";
import { ListChecksIcon } from "@phosphor-icons/react/dist/ssr";
import { ServerError } from "@/components/forms";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { useCreditBatches } from "@/hooks/use-credit-batches";
import { useRemovalTemplateSetup } from "@/hooks/use-removal-template-setup";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { certificationSettingsHref, removalTemplateSetupHref } from "@/lib/certification/links";
import { formatCount, MISSING_VALUE } from "@/lib/copy-utils";
import { SETUP_NOT_LINKED_MESSAGE } from "@/lib/certification/removal-template-blockers";
import { blockedCopy, blockedReasonLine, storedEntryCount } from "@/lib/certification/removal-template-setup-copy";

const EMPTY_ICON_SIZE = 32;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="body-small text-[var(--color-text-tertiary)]">{label}</dt>
      <dd className="body-small text-[var(--color-text-primary)]">{children}</dd>
    </>
  );
}

export function RemovalTemplateSummaryCard({ facilityId }: { facilityId: string }) {
  const query = useRemovalTemplateSetup(facilityId);
  const batches = useCreditBatches(facilityId);
  const retry = () => void query.refetch();

  if (query.isError && query.error?.message === SETUP_NOT_LINKED_MESSAGE) {
    return (
      <EmptyState
        icon={<ListChecksIcon size={EMPTY_ICON_SIZE} weight="bold" />}
        title="No Removal templates yet"
        description="Link this facility to an Isometric project in Certifier. Its Removal templates show here."
        padding="sm"
        action={<Link href={certificationSettingsHref(facilityId)} className="body-small underline underline-offset-2">Open Certifier</Link>}
      />
    );
  }
  if (query.isError) {
    return (
      <ServerError
        message="The Removal templates could not be read from Isometric."
        action={<Button size="small" busy={query.isFetching} onClick={retry}>Try again</Button>}
      />
    );
  }
  if (!query.data) {
    return <Skeleton className="h-160 w-full" aria-busy="true" aria-label="Loading Removal template" />;
  }

  const { data } = query;
  const canManage = data.viewerCanManage;
  const defaultId = data.defaultRemovalTemplateId;
  const defaultTemplate = data.fitting.find((template) => template.id === defaultId);
  const unfit = data.notFitting.find((template) => template.id === defaultId);
  // Review keeps the template; Change starts with nothing picked, like a first setup.
  const setupHref = (step: "template" | "decisions") => removalTemplateSetupHref(facilityId, { templateId: step === "decisions" ? defaultTemplate?.id : undefined, step });

  if (!defaultId) {
    return (
      <EmptyState
        icon={<ListChecksIcon size={EMPTY_ICON_SIZE} weight="bold" />}
        title="No Removal template set"
        description={data.fitting.length === 0
          ? "No template in this Isometric project fits this facility. Credit batches need a template before a Removal can be sent."
          : "Credit batches need a template before a Removal can be sent."}
        padding="sm"
        action={canManage ? (
          <Link href={removalTemplateSetupHref(facilityId)} className={buttonVariants({ variant: "primary" })}>Set up template</Link>
        ) : undefined}
      />
    );
  }

  // The default can be a template that no longer fits, is blocked, or has left Isometric.
  const problem = unfit
    ? unfit.reason
    : !defaultTemplate
      ? "The default template is no longer in this Isometric project."
      : defaultTemplate.blockedReason
        ? (canManage ? blockedCopy(defaultTemplate.blockedReason) : blockedReasonLine(defaultTemplate.blockedReason))
        : null;
  const name = defaultTemplate?.name ?? unfit?.name ?? "Default template not found";
  const toDecide = defaultTemplate && !defaultTemplate.blockedReason ? data.defaultToDecideCount : 0;
  const badge = problem
    ? <StatusBadge status="failed" label={unfit ? "Does not fit" : defaultTemplate ? "Not ready" : "Not found"} />
    : toDecide > 0
      ? <StatusBadge status="pending" label={`${formatCount(toDecide, "component")} to decide`} />
      : defaultTemplate?.ready ? <StatusBadge status="ready" /> : <StatusBadge status="pending" label="Not ready" />;
  const plan = defaultTemplate?.plan;
  const pinned = (batches.data ?? []).filter((batch) => batch.removalTemplateId === defaultId);

  return (
    <article aria-labelledby="template-summary-title" className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
      <div className="flex flex-col gap-16 p-20">
        <div className="flex flex-wrap items-center gap-12">
          <h3 id="template-summary-title" className="title-heading-3">{name}</h3>
          {badge}
        </div>
        {problem && <p className="body-small text-[var(--color-text-secondary)]">{`${problem}${canManage && !defaultTemplate?.blockedReason ? " Choose another template." : ""}`}</p>}
        <dl className="grid grid-cols-1 gap-x-16 gap-y-8 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-y-12">
          <Row label="Used by">
            {`Default for ${data.facility.name}. `}
            {pinned.length === 0 ? "No credit batches yet." : (
              <>
                {`${formatCount(pinned.length, "credit batch", "credit batches")}: `}
                {pinned.map((batch, index) => (
                  <span key={batch.id}>
                    <Link href={creditBatchDeepLinkHref(batch.id, facilityId)} className="underline underline-offset-2">{batch.code}</Link>
                    {index < pinned.length - 1 ? ", " : ""}
                  </span>
                ))}
              </>
            )}
          </Row>
          {plan && (
            <>
              <Row label="Components">
                {`${plan.decided.length} of ${defaultTemplate.componentCount} decided`}
              </Row>
              <Row label="Entries per credit batch">
                {`${formatCount(storedEntryCount(plan), "component")} ${storedEntryCount(plan) === 1 ? "takes" : "take"} an emissions entry on each credit batch`}
              </Row>
            </>
          )}
        </dl>
      </div>
      {canManage && (
        <div className="flex flex-wrap items-center gap-12 border-t border-[var(--color-border-tertiary)] px-20 py-12">
          {defaultTemplate && !defaultTemplate.blockedReason && (
            <Link href={setupHref("decisions")} className={buttonVariants({ size: "small", variant: "default" })}>Review decisions</Link>
          )}
          <Link href={setupHref("template")} className={buttonVariants({ size: "small", variant: "noOutline" })}>Change template</Link>
        </div>
      )}
    </article>
  );
}
