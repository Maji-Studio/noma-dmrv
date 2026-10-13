"use client";

import { useState } from "react";
import { toSaveErrorMessage } from "@/lib/stale-version";

export function usePickerEditSubmit<T>(save: (data: T) => Promise<unknown>, onClose: () => void) {
  const [error, setError] = useState<string>();
  const handleSubmit = async (data: T) => {
    setError(undefined);
    try {
      await save(data);
      onClose();
    } catch (cause) {
      setError(toSaveErrorMessage(cause, "The record was not saved. Try again."));
    }
  };
  return { error, handleSubmit, resetError: () => setError(undefined) };
}
