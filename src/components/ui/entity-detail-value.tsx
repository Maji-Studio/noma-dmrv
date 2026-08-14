"use client";

import { useEntityById } from "@/hooks/use-entities";
import type { EntityType } from "@/components/forms/entity-select/types";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { MISSING_VALUE } from "@/lib/copy-utils";

/** Matches the value line of a `DetailField` so the row does not jump on load. */
const VALUE_SKELETON_CLASS = "inline-block h-[16px] w-96 align-middle";

interface EntityDetailValueProps {
  entityType: EntityType;
  id: string | null | undefined;
}

/**
 * Resolves an existing entity relationship for a read-only DetailField value.
 *
 * The two missing outcomes return the shared tokens as plain strings, so the
 * surrounding `DetailField` applies the one placeholder treatment and reports
 * the field as absent to certification. An in-flight lookup is neither: it
 * renders the app's loading skeleton, because "Not available" would claim the
 * relation is broken before the app has looked.
 */
export function EntityDetailValue({ entityType, id }: EntityDetailValueProps) {
  const { data, isPending } = useEntityById(entityType, id ?? undefined);

  if (!id) return MISSING_VALUE.notSet;
  if (isPending) {
    return <Skeleton className={VALUE_SKELETON_CLASS} />;
  }
  if (!data) return MISSING_VALUE.notAvailable;
  return data.name || data.code || MISSING_VALUE.notAvailable;
}
