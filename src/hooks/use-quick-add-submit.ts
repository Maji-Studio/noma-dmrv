/**
 * useQuickAddSubmit
 *
 * Shared state + handler for quick-add dialog submissions.
 * Manages error/isSubmitting state, calls the server function,
 * seeds the entity cache, and invokes onSuccess/onClose.
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { seedEntityCache } from "@/components/forms/entity-select/cache-utils";
import type { EntityOption, EntityType } from "@/components/forms/entity-select/types";
import type { ActionResult } from "@/types/actions";

interface UseQuickAddSubmitOptions<TFormData> {
  entityType: EntityType;
  /** Transform form data and call the server action */
  serverFn: (data: TFormData) => Promise<ActionResult<EntityOption>>;
  onSuccess: (entity: EntityOption) => void;
  onClose: () => void;
}

export function useQuickAddSubmit<TFormData>({
  entityType,
  serverFn,
  onSuccess,
  onClose,
}: UseQuickAddSubmitOptions<TFormData>) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (data: TFormData) => {
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await serverFn(data);

      if (!result.success) {
        setError(result.error);
        return;
      }

      seedEntityCache(queryClient, entityType, result.data);
      onSuccess(result.data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  return { error, isSubmitting, handleSubmit };
}
