"use client";

import { useEntityById } from "@/hooks/use-entities";
import type { EntityType } from "@/components/forms/entity-select/types";

interface EntityDetailValueProps {
  entityType: EntityType;
  id: string | null | undefined;
}

/** Resolves an existing entity relationship for a read-only DetailField value. */
export function EntityDetailValue({ entityType, id }: EntityDetailValueProps) {
  const { data } = useEntityById(entityType, id ?? undefined);

  if (!id || !data) return "—";
  return data.name || data.code || "—";
}
