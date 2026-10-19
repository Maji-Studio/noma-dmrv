"use client";

import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { EntityType } from "@/components/forms/entity-select/types";
import { invalidateEntityTypeQueries } from "./entity-query-keys";

/**
 * For a picker that sends the operator to another tab to create a missing
 * record: returns a callback that, once called, reloads this entity type's
 * options when the operator comes back to this tab (window focus or the page
 * turning visible, whichever the browser reports first). React Query does not
 * refetch on focus in this app, so without it the new record would only
 * appear after a reload, and a reload would drop the form.
 */
export function useRefreshEntityOptionsOnReturn(entityType: EntityType) {
  const queryClient = useQueryClient();
  const isPending = useRef(false);

  return () => {
    if (isPending.current) return;
    isPending.current = true;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      isPending.current = false;
      invalidateEntityTypeQueries(queryClient, entityType);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
  };
}
