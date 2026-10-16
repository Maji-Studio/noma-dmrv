"use client";

import { useEffect, useState } from "react";
import { useQueryState } from "nuqs";
import { LOCATION_DEEP_LINK_PARAM } from "@/lib/entity-deep-link";

/** Open a loaded location once, then consume its URL intent after commit. */
export function useLocationEditIntent<T extends { id: string }>(
  locations: T[] | undefined,
  open: (location: T) => void,
) {
  const [intent, setIntent] = useQueryState(LOCATION_DEEP_LINK_PARAM);
  const [handledIntent, setHandledIntent] = useState<string | null>(null);
  const location = locations?.find(row => row.id === intent);
  if (location && intent !== handledIntent) {
    setHandledIntent(intent);
    open(location);
  } else if (intent === null && handledIntent !== null) {
    setHandledIntent(null);
  }

  // URL synchronization must happen after the dialog's open state commits.
  useEffect(() => {
    if (intent !== null && intent === handledIntent) void setIntent(null);
  }, [intent, handledIntent, setIntent]);
}
