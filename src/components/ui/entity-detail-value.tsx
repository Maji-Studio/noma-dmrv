"use client";

import { useEntityById } from "@/hooks/use-entities";
import type { EntityType } from "@/components/forms/entity-select/types";
import { MISSING_VALUE } from "@/lib/copy-utils";

interface EntityDetailValueProps {
  entityType: EntityType;
  id: string | null | undefined;
}

/** Resolves an existing entity relationship for a read-only DetailField value. */
export function EntityDetailValue({ entityType, id }: EntityDetailValueProps) {
  const { data } = useEntityById(entityType, id ?? undefined);

  if (!id) return MISSING_VALUE.notSet;
  if (!data) return MISSING_VALUE.notAvailable;
  return data.name || data.code || MISSING_VALUE.notAvailable;
}
