/**
 * RemovalTemplateReviewPanel — the "Removal templates" pane of Certification
 * settings. Lists the facility default template and every template a credit
 * batch pins, each with its lines and where every line gets its figure.
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
import { useRemovalTemplateReview } from "@/hooks/use-removal-template-review";
import { certificationSettingsHref } from "@/lib/certification/links";
import { RemovalTemplateReviewCard } from "./removal-template-review-card";

const EMPTY_ICON_SIZE = 32;

export interface RemovalTemplateReviewPanelProps {
  facilityId: string;
  canManage: boolean;
}

export function RemovalTemplateReviewPanel({ facilityId, canManage }: RemovalTemplateReviewPanelProps) {
  const query = useRemovalTemplateReview(facilityId);
  const retry = () => void query.refetch();

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
        message="The Removal templates could not be read from Isometric. Try again."
        action={<Button size="small" busy={query.isFetching} onClick={retry}>Try again</Button>}
      />
    );
  }

  if (query.data.length === 0) {
    return (
      <EmptyState
        icon={<ListChecksIcon size={EMPTY_ICON_SIZE} weight="bold" />}
        title="No Removal templates yet"
        description="Choose a default Removal template for this facility in Certifier. Its lines show here for review."
        padding="sm"
        action={
          <Link href={certificationSettingsHref(facilityId)} className="body-small underline underline-offset-2">
            Open Certifier
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-24">
      {query.data.map((entry) => (
        <RemovalTemplateReviewCard
          key={entry.templateId}
          entry={entry}
          facilityId={facilityId}
          canManage={canManage}
          onRetry={retry}
          isRetrying={query.isFetching}
        />
      ))}
    </div>
  );
}
