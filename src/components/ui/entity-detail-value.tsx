"use client";

import { useEntityById } from "@/hooks/use-entities";
import type { EntityType } from "@/components/forms/entity-select/types";
import { DetailValueSkeleton } from "@/components/ui/detail-panel";
import { LOAD_FAILED, MISSING_VALUE } from "@/lib/copy-utils";

/** A settled lookup that found no record for the saved ID. */
export const RECORD_NOT_FOUND = "Record not found";

interface EntityDetailValueProps {
  entityType: EntityType;
  id: string | null | undefined;
}

/**
 * Resolves an existing entity relationship for a read-only DetailField value.
 *
 * The missing outcomes return plain strings: the shared token for an
 * unchosen relation, the reason for a lookup that settled without a record,
 * and "Could not load" for a lookup that failed. A failed read is not a
 * missing record: it says nothing about whether the record exists. An
 * in-flight lookup is neither: it renders the app's loading skeleton, because
 * "Record not found" would claim the relation is broken before the app has
 * looked.
 */
export function EntityDetailValue({ entityType, id }: EntityDetailValueProps) {
  const { data, isPending, isError } = useEntityById(entityType, id ?? undefined);

  if (!id) return MISSING_VALUE.notSet;
  if (isPending) {
    return <DetailValueSkeleton />;
  }
  if (!data) return isError ? LOAD_FAILED : RECORD_NOT_FOUND;
  return data.name || data.code || "Record has no name";
}
