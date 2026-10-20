"use client";

import { useRef } from "react";

/** One draft per hook instance. Read and rotate only in mutation/event callbacks. */
export function useCreateIntentKey() {
  const key = useRef<string | undefined>(undefined);
  return {
    current(): string {
      key.current ??= crypto.randomUUID();
      return key.current;
    },
    rotate(): void {
      key.current = crypto.randomUUID();
    },
  };
}
