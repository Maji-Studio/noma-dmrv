/**
 * useQuickAddSubmit
 *
 * Shared state + handler for quick-add dialog submissions.
 * Manages error/isSubmitting state, calls the server function,
 * seeds the entity cache, and invokes onSuccess/onClose.
 *
 * A refused create is thrown as an `ActionError` and handed to the form's
 * `onRefusal` (#1327), so a form on the shared refusal handler shows it at its
 * fields. A form that passes no handler keeps the message line.
 */

import { useCreateIntentKey } from "./use-create-intent-key";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SaveRefusalHandler } from "@/components/forms/use-save-refusal";
import { throwActionError } from "@/lib/stale-version";
import { seedEntityCache } from "@/components/forms/entity-select/cache-utils";
import type { EntityOption, EntityType } from "@/components/forms/entity-select/types";
import type { ActionResult } from "@/types/actions";

interface UseQuickAddSubmitOptions<TFormData> {
  entityType: EntityType;
  /** Transform form data and call the server action */
  serverFn: (data: TFormData, intentKey: string) => Promise<ActionResult<EntityOption>>;
  onSuccess: (entity: EntityOption) => void;
  onClose: () => void;
}

export function useQuickAddSubmit<TFormData>({
  entityType,
  serverFn,
  onSuccess,
  onClose,
}: UseQuickAddSubmitOptions<TFormData>) {
  const intent = useCreateIntentKey();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (data: TFormData, onRefusal?: SaveRefusalHandler) => {
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await serverFn(data, intent.current());

      if (!result.success) throwActionError(result);

      intent.rotate();
      seedEntityCache(queryClient, entityType, result.data);
      onSuccess(result.data);
      onClose();
    } catch (err) {
      const fallback =
        err instanceof Error
          ? err.message
          : "Record was not created. Check the form.";
      setError(onRefusal ? onRefusal(err, fallback) : fallback);
    } finally {
      setIsSubmitting(false);
    }
  };

  return { error, isSubmitting, handleSubmit, startDraft: intent.rotate };
}
