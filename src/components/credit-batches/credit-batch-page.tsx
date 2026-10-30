"use client";

/**
 * The routed credit batch page, `/credit-batches/[id]?tab=` (epic #1136).
 *
 * Header (code, feedstock, window, one state-driven action, progress, key
 * numbers), then tabs: Overview, Production, Samples, Emissions, Removals,
 * Activities. Traceability is a link beside the tabs and in the ⋯ menu.
 * Edit opens the batch form in a side sheet over the page; delete sits under
 * ⋯. The route has already org-scoped the batch and matched its facility.
 */
import { creditBatchLabel } from "@/lib/credit-batch-label";
import { recordHref, CREDIT_BATCH_TAB_PARAM } from "@/lib/record-links";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { ServerError } from "@/components/forms";
import { EntityNotFound } from "@/components/navigation";
import { recordLockSheetProps } from "@/components/record-locks";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet } from "@/components/ui/entity-side-sheet";
import { InUseDeleteDialog } from "@/components/ui/in-use-delete-dialog";
import { useToast } from "@/components/ui/toast";
import { useCreditBatchTodos } from "@/hooks/use-certification";
import {
  useCreditBatch,
  useCreditBatchPageModel,
  useDeleteCreditBatch,
  useUpdateCreditBatch,
} from "@/hooks/use-credit-batches";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useNavigateWithToast } from "@/hooks/use-navigate-with-toast";
import { useRecordLock } from "@/hooks/use-record-locks";
import { creditBatchListHref } from "@/lib/certification/batch-health-links";
import { ConflictError } from "@/lib/conflict-ref";
import type { SaveRefusalHandler } from "@/components/forms/use-save-refusal";
import { certificationRemovalsHref, traceabilityBatchHref } from "@/lib/certification/links";
import { CREATE_INTENT_PARAM } from "@/lib/create-intent";
import { Button } from "@/components/ui/button";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { useLinkedRecordFacility } from "@/hooks/use-linked-record-facility";
import { linkedRecordReadOnly } from "@/lib/linked-record-read-only";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import {
  CREDIT_BATCH_PAGE_TAB_LABELS,
  CREDIT_BATCH_PAGE_TABS,
  creditBatchPrimaryAction,
  readOnlyOpenItems,
  todosLabel,
  tabBadge,
  type CreditBatchPageTab,
  type CreditBatchPrimaryAction,
} from "@/lib/credit-batches/batch-page";
import {
  buildCreditBatchWaitingItems,
  CREDIT_BATCH_DETAILS_ROW,
  type CreditBatchOpenItem,
} from "@/lib/credit-batches/open-items";
import { ENTITY_DEEP_LINK_FOCUS_PARAM } from "@/lib/entity-deep-link";
import { formatDateRange } from "@/lib/format-utils";
import { isRecordEditable } from "@/lib/record-lock-view";
import { toDeleteErrorMessage } from "@/lib/stale-version";
import { cn } from "@/lib/utils";
import type { CreditBatchFormData } from "@/schemas/credit-batches";
import { CreditBatchForm } from "./credit-batch-form";
import { CREDIT_BATCH_DELETE_MESSAGE } from "./credit-batch-list";
import { CreditBatchEmissionsTab } from "./credit-batch-emissions-tab";
import { CreditBatchPageProvider, useCreditBatchPage, type CreditBatchPageContextValue } from "./credit-batch-page-context";
import { CreditBatchKeyNumbers, CreditBatchPageHeader } from "./credit-batch-page-header";
import { CreditBatchOverview } from "./credit-batch-page-overview";
import { CountBadge, FOCUS_RING, MUTED_TEXT, StatusDot, TODO_TONE } from "./credit-batch-page-parts";
import { CreditBatchRemovalsTab } from "./credit-batch-page-removals";
import { CreditBatchActivitiesTab, CreditBatchProductionTab, CreditBatchSamplesTab } from "./credit-batch-page-tabs";
import { isCreditBatchMembershipLocked, saveCreditBatchEdit } from "./credit-batch-update-patch";

const QUERY_OPTIONS = { shallow: true, history: "replace" } as const;
const NOT_FOUND_COPY = {
  title: "Credit batch not found",
  description: "This credit batch does not exist or is not available in the selected facility.",
  backLabel: "Back to credit batches",
} as const;

/** Keeps the selected tab inside the scrolling tab row on phones, without moving the page. */
function revealTab(node: HTMLButtonElement | null) {
  const row = node?.parentElement;
  if (!node || !row) return;
  // The row is `relative`, so offsetLeft is measured from its start.
  const left = node.offsetLeft;
  const right = left + node.offsetWidth;
  if (left < row.scrollLeft) row.scrollLeft = left;
  else if (right > row.scrollLeft + row.clientWidth) row.scrollLeft = right - row.clientWidth;
}

function BatchTabs({ tabListRef }: { tabListRef: React.RefObject<HTMLDivElement | null> }) {
  const { batch, tab, go, openItems } = useCreditBatchPage();
  return (
    <div ref={tabListRef} className="flex scroll-mt-24 items-stretch border-b border-[var(--color-border-secondary)]">
      {/* The tab row scrolls inside its bar on phones; the page never scrolls sideways. */}
      <div role="tablist" aria-label="Credit batch sections" className="relative flex min-w-0 flex-1 overflow-x-auto">
        {CREDIT_BATCH_PAGE_TABS.map((key) => {
          const badge = tabBadge(key, openItems);
          return (
            <button
              key={key}
              id={`credit-batch-tab-${key}`}
              role="tab"
              type="button"
              aria-selected={tab === key}
              aria-controls="credit-batch-tab-panel"
              ref={tab === key ? revealTab : undefined}
              onClick={() => go(key)}
              className={cn(
                "-mb-px inline-flex h-44 shrink-0 items-center gap-8 border-b-2 px-16 body-medium first:pl-0",
                FOCUS_RING,
                tab === key
                  ? "border-[var(--ink)] font-medium"
                  : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
              )}
            >
              {CREDIT_BATCH_PAGE_TAB_LABELS[key]}
              {badge &&
                (tab === key ? (
                  <CountBadge count={badge.count} blocking={badge.blocking} label={todosLabel(badge.count)} />
                ) : (
                  <StatusDot tone={badge.blocking ? TODO_TONE.blocking : TODO_TONE.check} label={todosLabel(badge.count)} />
                ))}
            </button>
          );
        })}
      </div>
      {/* Phones reach Traceability through the ⋯ menu; the tab row has no room. */}
      <Link
        href={traceabilityBatchHref(batch.id, batch.facilityId)}
        className={cn("hidden shrink-0 items-center gap-6 pl-16 body-small underline-offset-2 hover:text-[var(--color-text-primary)] hover:underline sm:inline-flex", MUTED_TEXT, FOCUS_RING)}
      >
        Open in Traceability
        <ArrowSquareOutIcon size={16} aria-hidden />
      </Link>
    </div>
  );
}

function TabBody() {
  const { tab, batch, pageModel, pageModelError, retryPageModel, retryingPageModel } = useCreditBatchPage();
  const needsModel = tab === "removals";
  if (needsModel && pageModelError) {
    return (
      <ServerError
        message="The Removals for this credit batch could not be loaded."
        action={<Button variant="weak" size="small" busy={retryingPageModel} onClick={retryPageModel}>Retry</Button>}
      />
    );
  }
  if (needsModel && !pageModel) {
    return <p className={cn("body-small", MUTED_TEXT)} aria-busy>Loading Removals…</p>;
  }
  switch (tab) {
    case "production": return <CreditBatchProductionTab />;
    case "samples": return <CreditBatchSamplesTab />;
    case "emissions": return <CreditBatchEmissionsTab />;
    case "removals": return <CreditBatchRemovalsTab />;
    case "activities": return <CreditBatchActivitiesTab />;
    default: return <CreditBatchOverview />;
  }
}

export function CreditBatchPage({
  creditBatchId,
  canManage,
}: {
  creditBatchId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const tabListRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useQueryState(
    CREDIT_BATCH_TAB_PARAM,
    parseAsStringLiteral(CREDIT_BATCH_PAGE_TABS).withDefault("overview").withOptions(QUERY_OPTIONS),
  );
  const [focus, setFocus] = useQueryState(ENTITY_DEEP_LINK_FOCUS_PARAM, parseAsString.withOptions(QUERY_OPTIONS));
  // The batch as Edit opened it: the form keeps this identity and version until
  // it saves or closes, so a background refetch never drops a draft and a
  // concurrent save answers as the stale-version conflict.
  const [editSnapshot, setEditSnapshot] = useState<CreditBatchWithRelations | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  // The batch as the delete dialog opened on it: a refetch while it is open
  // never deletes against changes the operator has not seen.
  const [deleting, setDeleting] = useState<{ id: string; version: number } | null>(null);
  const [deleteConflict, setDeleteConflict] = useState<ConflictError | null>(null);

  const { facilityId: contextFacilityId, isResolving } = useFacilityContext();
  const batchQuery = useCreditBatch(creditBatchId);
  const pageModel = useCreditBatchPageModel(creditBatchId);
  const { lock, status: lockStatus, retry: retryLock, retrying: lockRetrying } = useRecordLock("creditBatch", creditBatchId);
  const updateCreditBatch = useUpdateCreditBatch();
  const deleteCreditBatch = useDeleteCreditBatch();
  const toList = useNavigateWithToast();

  const batch = batchQuery.data;
  const todos = useCreditBatchTodos(batch
    ? { facilityId: batch.facilityId, creditBatchId: batch.id }
    : null);
  // The page never moves the working facility: a batch in another active facility stays "not found" here.
  const linkedRecord = useLinkedRecordFacility(batch, batchQuery.isLoading, { switchFacility: false });
  // A link into an archived facility (or one that could not be checked) opens
  // the batch read only instead of "not found".
  const readOnly = linkedRecordReadOnly(linkedRecord, batch, "credit batch");
  // Until the facility lookup settles, neither the batch nor "not found" is true yet.
  if (batch && !linkedRecord.ready) return null;
  if (!batch || (contextFacilityId && !isResolving && contextFacilityId !== batch.facilityId && !readOnly)) {
    if (batchQuery.isPending) return null;
    return (
      <EntityNotFound
        {...NOT_FOUND_COPY}
        backHref={contextFacilityId ? creditBatchListHref(contextFacilityId) : "/credit-batches"}
      />
    );
  }

  // A failed to-do read shows no list at all, not a partial one.
  // React Query keeps old data on a failed refetch, so ignore it on error.
  const current = todos.isError ? undefined : todos.data;
  const todoItems = current
    ? { blocking: current.blocking, check: current.check, waiting: buildCreditBatchWaitingItems(pageModel.data) }
    : { blocking: [], check: [], waiting: [] as ReturnType<typeof buildCreditBatchWaitingItems> };
  // Read only, to-dos are plain text: no Edit, no repair link. Tabs stay reachable.
  const openItems = readOnly ? readOnlyOpenItems(todoItems) : todoItems;
  const blocking = current ? openItems.blocking : undefined;
  const editable = isRecordEditable(lock);
  const membershipLocked = isCreditBatchMembershipLocked(lock);
  const primary = readOnly ? null : creditBatchPrimaryAction({ blocking, pageModel: pageModel.data, lock });

  const startEdit = () => {
    setUpdateError(null);
    setEditSnapshot(batch);
  };
  const closeEdit = () => setEditSnapshot(null);

  const go = (next: CreditBatchPageTab, row?: string | null) => {
    void setTab(next === "overview" ? null : next);
    void setFocus(row ?? null);
    if (!row) tabListRef.current?.scrollIntoView({ block: "start" });
  };

  const openItem = (item: CreditBatchOpenItem) => {
    if (!item.target) return;
    if ("href" in item.target) {
      router.push(item.target.href);
      return;
    }
    go(item.target.tab, item.target.rowId);
    // Batch details are fixed in the edit form, so the form opens with them.
    if (item.target.rowId === CREDIT_BATCH_DETAILS_ROW && editable && !readOnly) startEdit();
  };

  // Removals are made in the certification workspace, behind its registry guard.
  const onPrimary = (action: CreditBatchPrimaryAction) => {
    if (action.kind === "draft") router.push(recordHref("removal", action.removalId, { facilityId: batch.facilityId }));
    else router.push(certificationRemovalsHref({ facility: batch.facilityId, [CREATE_INTENT_PARAM]: "true" }));
  };

  const handleUpdate = async (data: CreditBatchFormData, onRefusal: SaveRefusalHandler) => {
    if (!editSnapshot) return;
    setUpdateError(null);
    const outcome = await saveCreditBatchEdit({
      data,
      saved: editSnapshot,
      lock: lock,
      update: (input) => updateCreditBatch.mutateAsync(input),
    });
    if (outcome.status === "error") {
      setUpdateError(onRefusal(outcome.cause, outcome.message));
      return;
    }
    closeEdit();
    if (outcome.warning) toast.warning(`${outcome.warning} Refresh the page.`);
    else toast.success("Credit batch updated.");
  };

  const handleDeleteConfirm = async () => {
    if (!deleting) return;
    try {
      await deleteCreditBatch.mutateAsync({ creditBatchId: deleting.id, expectedVersion: deleting.version });
      // The dialog stays open and busy until the list has rendered; the toast arrives with it.
      toList.navigate(creditBatchListHref(batch.facilityId), "Credit batch deleted.");
    } catch (error) {
      setDeleting(null);
      if (error instanceof ConflictError) setDeleteConflict(error);
      else toast.error(toDeleteErrorMessage(error, "Credit batch", "Credit batch was not deleted. Try again."));
    }
  };

  const value: CreditBatchPageContextValue = {
    batch,
    pageModel: pageModel.data,
    pageModelError: pageModel.error,
    retryPageModel: () => void pageModel.refetch(),
    retryingPageModel: pageModel.isFetching,
    openItems,
    blockingCount: blocking ? blocking.length : null,
    todosError: todos.error,
    linesToDecide: current?.linesToDecide ?? 0,
    retryTodos: () => void todos.refetch(),
    retryingTodos: todos.isFetching,
    lock,
    lockStatus,
    canManage: canManage && !readOnly,
    readOnly,
    archived: !!readOnly && linkedRecord.readOnly?.reason === "archived",
    facilityTimeZone: linkedRecord.readOnly?.reason === "archived" && readOnly ? linkedRecord.readOnly.timezone : undefined,
    tab,
    focus,
    go,
    openItem,
    startEdit: editable && !readOnly ? startEdit : null,
  };

  const conflictHref = deleteConflict?.conflict.entity === "sample"
    ? recordHref("sample", deleteConflict.conflict.id, { facilityId: batch.facilityId })
    : null;

  return (
    <CreditBatchPageProvider value={value}>
      <div className="container-max page-shell min-w-0">
        {readOnly && <ReadOnlyNotice readOnly={readOnly} />}
        <CreditBatchPageHeader primary={primary} onPrimary={onPrimary} onDelete={() => setDeleting({ id: batch.id, version: batch.version })} />
        <CreditBatchKeyNumbers />
        <div className="flex min-w-0 flex-col gap-24">
          <BatchTabs tabListRef={tabListRef} />
          <div id="credit-batch-tab-panel" role="tabpanel" aria-labelledby={`credit-batch-tab-${tab}`} className="min-w-0">
            <TabBody />
          </div>
        </div>
      </div>

      <EntitySideSheet
        open={!readOnly && editSnapshot !== null}
        onOpenChange={(open) => !open && closeEdit()}
        mode="edit"
        onModeChange={(mode) => mode === "view" && closeEdit()}
        title={creditBatchLabel(batch)}
        subtitle={formatDateRange(batch.startDate, batch.endDate)}
        canEdit={editable && !readOnly}
        {...recordLockSheetProps({ lock, status: lockStatus, retry: retryLock, retrying: lockRetrying, inUseLocksNothing: !membershipLocked })}
        size="wide"
      >
        <CreditBatchForm
          key={batch.id}
          creditBatch={editSnapshot ?? batch}
          onSubmit={handleUpdate}
          onClearServerError={() => setUpdateError(null)}
          onCancel={closeEdit}
          isSubmitting={updateCreditBatch.isPending}
          errorMessage={updateError ?? undefined}
          canManage={canManage}
          lock={lock}
        />
      </EntitySideSheet>

      <DeleteConfirmDialog
        isOpen={deleting !== null}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleting(null)}
        title="Delete credit batch"
        message={CREDIT_BATCH_DELETE_MESSAGE}
        isPending={deleteCreditBatch.isPending || toList.isPending}
      />
      {deleteConflict && (
        <InUseDeleteDialog label={batch.code} onClose={() => setDeleteConflict(null)}>
          <p>
            {deleteConflict.message}{" "}
            {conflictHref && (
              <Link href={conflictHref} className="underline underline-offset-4 text-[var(--color-text-primary)]">
                Open {deleteConflict.conflict.code}
              </Link>
            )}
          </p>
        </InUseDeleteDialog>
      )}

    </CreditBatchPageProvider>
  );
}
