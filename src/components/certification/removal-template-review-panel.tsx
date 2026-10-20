/**
 * RemovalTemplateReviewPanel: the "Removal templates" pane of Certification
 * settings, the one place a Removal template is set up. Lists every Removal
 * template of the facility's Isometric project (the default first, then the
 * ones credit batches use), each with its lines and noma's decision per line.
 * An Owner or Admin chooses the facility default here.
 *
 * Every viewer can read it; `canManage` (server-computed, Owner or Admin) adds
 * the assignment controls. The review reads the templates live from Isometric,
 * so Retry is a refetch of the same query.
 */
"use client";

import Link from "next/link";
import { ListChecksIcon } from "@phosphor-icons/react/dist/ssr";
import { ServerError } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useRemovalTemplateReview, useRemovalTemplateReviewEntry } from "@/hooks/use-removal-template-review";
import { facilityCertificationSettingsHref } from "@/lib/certification/links";
import { RemovalTemplateReviewCard } from "./removal-template-review-card";

const EMPTY_ICON_SIZE = 32;

export interface RemovalTemplateReviewPanelProps {
  facilityId: string;
  canManage: boolean;
  /**
   * A template the operator asked to see (`?template=`). One the facility does
   * not list yet is read and shown first, read-only; nothing is observed.
   */
  templateId?: string | null;
}

export function RemovalTemplateReviewPanel({ facilityId, canManage, templateId }: RemovalTemplateReviewPanelProps) {
  const query = useRemovalTemplateReview(facilityId);
  const retry = () => void query.refetch();
  const requested = templateId ?? "";
  const listed = !!query.data?.some((entry) => entry.templateId === requested);
  // Wait for the list first so a listed template is never read twice.
  const preview = useRemovalTemplateReviewEntry(facilityId, requested, !!requested && !!query.data && !listed);

  if (query.isLoading && !query.data) {
    return (
      <div className="flex flex-col gap-16" aria-busy="true" aria-label="Loading Removal templates">
        <Skeleton className="h-160 w-full" />
        <Skeleton className="h-160 w-full" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <ServerError
        message="The Removal templates could not be read from Isometric."
        action={<Button size="small" busy={query.isFetching} onClick={retry}>Try again</Button>}
      />
    );
  }

  // The requested template leads, whether it is listed or only previewed.
  const entries = [
    ...(preview.data && !listed ? [preview.data] : []),
    ...query.data.filter((entry) => entry.templateId === requested),
    ...query.data.filter((entry) => entry.templateId !== requested),
  ];
  const previewFailed = !!requested && !listed && preview.isError;

  if (requested && !listed && preview.isPending) {
    return (
      <div className="flex flex-col gap-16" aria-busy="true" aria-label="Loading template components">
        <Skeleton className="h-160 w-full" />
      </div>
    );
  }

  if (entries.length === 0 && !previewFailed) {
    return (
      <EmptyState
        icon={<ListChecksIcon size={EMPTY_ICON_SIZE} weight="bold" />}
        title="No Removal templates yet"
        description="Link this facility to an Isometric project in Settings, Facilities. Its Removal templates show here."
        padding="sm"
        action={
          <Link href={facilityCertificationSettingsHref(facilityId)} className="body-small underline underline-offset-2">
            Open Facilities
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-24">
      {previewFailed && (
        <ServerError
          message="That template's components could not be read from Isometric."
          action={<Button size="small" busy={preview.isFetching} onClick={() => void preview.refetch()}>Try again</Button>}
        />
      )}
      {entries.map((entry) => (
        <RemovalTemplateReviewCard
          key={entry.templateId}
          entry={entry}
          facilityId={facilityId}
          canManage={canManage}
          // Only the linked template Isometric's list did not include is read on its own.
          onRetry={!listed && entry.templateId === requested ? () => void preview.refetch() : retry}
          isRetrying={!listed && entry.templateId === requested ? preview.isFetching : query.isFetching}
          defaultExpanded={entry.isDefault || entry.templateId === requested}
        />
      ))}
    </div>
  );
}
