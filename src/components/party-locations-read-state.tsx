import { useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { PartyLocationDetail } from "./party-location-detail-fields";
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
