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
import { storedEntryCount, toDecideLabel } from "@/lib/certification/removal-template-setup-copy";

const EMPTY_ICON_SIZE = 32;
const NOT_LINKED_MESSAGE = "Link this facility to an Isometric project first.";

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

  if (query.isError && query.error?.message === NOT_LINKED_MESSAGE) {
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
  const defaultTemplate = data.fitting.find((template) => template.id === data.defaultRemovalTemplateId);
  const unfit = data.notFitting.find((template) => template.id === data.defaultRemovalTemplateId);
  const setupHref = (step?: "template" | "decisions") => removalTemplateSetupHref(facilityId, { templateId: defaultTemplate?.id, step });

  if (!data.defaultRemovalTemplateId || (!defaultTemplate && !unfit)) {
    return (
      <EmptyState
        icon={<ListChecksIcon size={EMPTY_ICON_SIZE} weight="bold" />}
        title="No Removal template set"
        description={data.fitting.length === 0
          ? "No template in this Isometric project fits this facility. Credit batches need a template before a Removal can be sent."
          : "Credit batches need a template before a Removal can be sent."}
        padding="sm"
        action={data.viewerCanManage && data.fitting.length > 0 ? (
          <Link href={removalTemplateSetupHref(facilityId)} className={buttonVariants({ variant: "primary" })}>Set up template</Link>
        ) : (
          <p className="body-small text-[var(--color-text-secondary)]">Owners and Admins can set it up.</p>
        )}
      />
    );
  }

  const name = defaultTemplate?.name ?? unfit?.name ?? "";
  const decided = defaultTemplate?.plan.decided ?? [];
  const confirmed = decided.filter((line) => line.contract?.origin === "reviewed").length;
  const byNoma = decided.length - confirmed;
  const pinned = (batches.data ?? []).filter((batch) => batch.removalTemplateId === data.defaultRemovalTemplateId);

  return (
    <div className="flex flex-col gap-12">
      <article aria-labelledby="template-summary-title" className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
        <div className="flex flex-col gap-16 p-20">
          <div className="flex flex-wrap items-center gap-12">
            <h3 id="template-summary-title" className="title-heading-3">{name}</h3>
            {defaultTemplate && (
              data.defaultToDecideCount > 0
                ? <StatusBadge status="pending" label={toDecideLabel(data.defaultToDecideCount)} />
                : <StatusBadge status="ready" />
            )}
          </div>
          {unfit && <p className="body-small text-[var(--color-text-secondary)]">{`${unfit.reason} Choose another template.`}</p>}
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
            {defaultTemplate && (
              <>
                <Row label="Decided by you">{confirmed === 0 ? MISSING_VALUE.none : formatCount(confirmed, "component")}</Row>
                <Row label="Decided by noma">{byNoma === 0 ? MISSING_VALUE.none : formatCount(byNoma, "component")}</Row>
                <Row label="Entries per batch">
                  {`${formatCount(storedEntryCount(defaultTemplate.plan), "component")} ${storedEntryCount(defaultTemplate.plan) === 1 ? "takes" : "take"} an emissions entry on each credit batch`}
                </Row>
              </>
            )}
          </dl>
        </div>
        {data.viewerCanManage && (
          <div className="flex flex-wrap items-center gap-12 border-t border-[var(--color-border-tertiary)] px-20 py-12">
            {defaultTemplate && (
              <Link href={setupHref("decisions")} className={buttonVariants({ size: "small", variant: "default" })}>Review decisions</Link>
            )}
            <Link href={setupHref("template")} className={buttonVariants({ size: "small", variant: "noOutline" })}>Change template</Link>
          </div>
        )}
      </article>
    </div>
  );
}

