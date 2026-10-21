/**
 * RemovalTemplateSummaryCard: the "Removal templates" pane of Certification
 * settings. One card for the template this facility's credit batches use:
 * status, where it is used, how many components were decided and by whom, and
 * how many take an emissions entry. Admins get Set up template, Review
 * decisions and Change template, all opening the setup dialog; Members read the
 * same card without buttons and a setup link does not open the dialog for them.
 * Decisions are stored per organization and template, so the caption says they
 * reach every facility using it.
 *
 * Read live from Isometric through the setup read, which stores nothing.
 */
"use client";

import Link from "next/link";
import { parseAsString, useQueryStates } from "nuqs";
import { ListChecksIcon } from "@phosphor-icons/react/dist/ssr";
import { ServerError } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { useCreditBatches } from "@/hooks/use-credit-batches";
import { useRemovalTemplateSetup } from "@/hooks/use-removal-template-setup";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import {
  REMOVAL_TEMPLATES_MAKE_DEFAULT_PARAM,
  REMOVAL_TEMPLATES_SETUP_PARAM,
  REMOVAL_TEMPLATES_TEMPLATE_PARAM,
  facilityCertificationSettingsHref,
} from "@/lib/certification/links";
import { formatCount } from "@/lib/copy-utils";
import { SETUP_NOT_LINKED_MESSAGE } from "@/lib/certification/removal-template-blockers";
import { RemovalTemplateSetupDialog } from "./removal-template-setup/removal-template-setup-dialog";
import { blockedCopy, blockedReasonLine, storedEntryCount } from "@/lib/certification/removal-template-setup-copy";

const EMPTY_ICON_SIZE = 32;
/** The dialog is open while `setup` is in the URL, so a link and a button open the same thing. */
const SETUP_PARAMS = {
  [REMOVAL_TEMPLATES_SETUP_PARAM]: parseAsString,
  [REMOVAL_TEMPLATES_TEMPLATE_PARAM]: parseAsString,
  [REMOVAL_TEMPLATES_MAKE_DEFAULT_PARAM]: parseAsString,
};
const CLOSED_SETUP = {
  [REMOVAL_TEMPLATES_SETUP_PARAM]: null,
  [REMOVAL_TEMPLATES_TEMPLATE_PARAM]: null,
  [REMOVAL_TEMPLATES_MAKE_DEFAULT_PARAM]: null,
};

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
  const [request, setRequest] = useQueryStates(SETUP_PARAMS, { shallow: true, history: "replace" });
  const openSetup = (step: "template" | "decisions", templateId: string | null) => void setRequest({
    ...CLOSED_SETUP,
    [REMOVAL_TEMPLATES_SETUP_PARAM]: step,
    [REMOVAL_TEMPLATES_TEMPLATE_PARAM]: templateId,
  });
  // The dialog sits beside the card, not inside a branch, so it survives the card changing state after Apply.
  // Members never mount it, so a setup link only shows them the card.
  return (
    <>
      <SummaryBody facilityId={facilityId} onOpenSetup={openSetup} />
      {query.data?.viewerCanManage && (
        <RemovalTemplateSetupDialog
          isOpen={!!request.setup}
          facilityId={facilityId}
          hasDefaultTemplate={!!query.data.defaultRemovalTemplateId}
          templateId={request.template}
          step={request.setup}
          makeDefault={request.makeDefault !== "false"}
          onClose={() => void setRequest(CLOSED_SETUP)}
        />
      )}
    </>
  );
}

function SummaryBody({ facilityId, onOpenSetup }: { facilityId: string; onOpenSetup: (step: "template" | "decisions", templateId: string | null) => void }) {
  const query = useRemovalTemplateSetup(facilityId);
  const batches = useCreditBatches(facilityId);
  const retry = () => void query.refetch();

  if (query.isError && query.error?.message === SETUP_NOT_LINKED_MESSAGE) {
    return (
      <EmptyState
        icon={<ListChecksIcon size={EMPTY_ICON_SIZE} weight="bold" />}
        title="No Removal templates yet"
        description="Link this facility to an Isometric project in Settings, Facilities. Its Removal templates show here."
        padding="sm"
        action={<Link href={facilityCertificationSettingsHref(facilityId)} className="body-small underline underline-offset-2">Open Settings, Facilities</Link>}
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
  const openSetup = (step: "template" | "decisions") => onOpenSetup(step, step === "decisions" ? (defaultTemplate?.id ?? null) : null);

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
          <Button variant="primary" onClick={() => openSetup("template")}>Set up template</Button>
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
            <Button size="small" variant="default" onClick={() => openSetup("decisions")}>Review decisions</Button>
          )}
          <Button size="small" variant="noOutline" onClick={() => openSetup("template")}>Change template</Button>
        </div>
      )}
    </article>
  );
}
