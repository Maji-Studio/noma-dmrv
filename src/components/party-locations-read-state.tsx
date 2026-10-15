import { useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { buildPartyLocationDetailFields, type PartyLocationDetail } from "./party-location-detail-fields";
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

export type PartyLocationsQueryState = Pick<
  UseQueryResult<PartyLocationDetail[]>,
  "data" | "isPending" | "isError" | "isFetching" | "refetch"
>;

interface PartyLocationsReadStateProps {
  partyLabel: "Customer" | "Supplier";
  isPending: boolean;
  isError: boolean;
  isRetrying: boolean;
  hasCachedData?: boolean;
  onRetry: () => void;
}

export function partyLocationsSection(
  partyLabel: PartyLocationsReadStateProps["partyLabel"],
  partyId: string,
  locationsQuery: PartyLocationsQueryState,
  fieldOptions: Omit<Parameters<typeof buildPartyLocationDetailFields>[1], "pending">,
): DetailPanelSection {
  return {
    title: "Locations",
    fields:
      locationsQuery.isError && locationsQuery.data === undefined
        ? []
        : buildPartyLocationDetailFields(locationsQuery.data ?? [], {
            ...fieldOptions,
            pending: locationsQuery.isPending,
          }),
    content: (
      <PartyLocationsReadState
        key={partyId}
        partyLabel={partyLabel}
        isPending={locationsQuery.isPending}
        isError={locationsQuery.isError}
        isRetrying={locationsQuery.isFetching}
        hasCachedData={locationsQuery.data !== undefined}
        onRetry={() => void locationsQuery.refetch()}
      />
    ),
  };
}

export function PartyLocationsReadState({
  partyLabel,
  isPending,
  isError,
  isRetrying,
  hasCachedData = false,
  onRetry,
}: PartyLocationsReadStateProps) {
  const [hasRetried, setHasRetried] = useState(false);
  const [wasRetrying, setWasRetrying] = useState(isRetrying);

  if (wasRetrying !== isRetrying) {
    setWasRetrying(isRetrying);
    if (!isRetrying) setHasRetried(false);
  }

  function handleRetry() {
    setHasRetried(true);
    onRetry();
  }

  // A retry without cached data returns the query to pending.
  if (isError || (hasRetried && isPending)) {
    return (
      <Notice
        tone="warning"
        action={
          <Button
            variant="weak"
            size="small"
            busy={isRetrying}
            onClick={handleRetry}
          >
            Retry
          </Button>
        }
      >
        {hasCachedData
          ? `Could not refresh ${partyLabel.toLowerCase()} locations. Showing the last saved values.`
          : `${partyLabel} locations unavailable. Retry to load saved locations.`}
      </Notice>
    );
  }

  if (isPending) {
    return (
      <span
        className="body-caption text-[var(--color-text-tertiary)]"
        role="status"
      >
        Loading {partyLabel.toLowerCase()} locations…
      </span>
    );
  }

  return null;
}
