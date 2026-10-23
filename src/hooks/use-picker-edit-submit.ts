"use client";

import { useState } from "react";
import type { SaveRefusalHandler } from "@/components/forms/use-save-refusal";
import { toSaveErrorMessage } from "@/lib/stale-version";

/**
 * Submit seam of the picker edit dialogs. A form on the shared save refusal
 * (#1327) gets its handler here and decides the footer; the caught
 * `ActionError` reaches it unchanged. A form that is not on the hook yet
 * ignores the second argument and keeps the message line.
 */
export function usePickerEditSubmit<T>(save: (data: T) => Promise<unknown>, onClose: () => void) {
  const [error, setError] = useState<string>();
  const handleSubmit = async (data: T, onRefusal?: SaveRefusalHandler) => {
    setError(undefined);
    try {
      await save(data);
      onClose();
    } catch (cause) {
      const fallback = toSaveErrorMessage(cause, "The record was not saved. Try again.");
      setError(onRefusal ? (onRefusal(cause, fallback) ?? undefined) : fallback);
    }
  };
  return { error, handleSubmit, resetError: () => setError(undefined) };
}
