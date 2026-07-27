"use client";

import { useState } from "react";

interface ServerErrorSnapshot {
  message: string | undefined;
  fieldFingerprint: string;
}

export function useInlineStockServerError(
  errorMessage: string | undefined,
  fieldFingerprint: string,
  isStockError: (message: string) => boolean,
) {
  const [snapshot, setSnapshot] = useState<ServerErrorSnapshot>({
    message: errorMessage,
    fieldFingerprint,
  });
  let currentSnapshot = snapshot;

  if (errorMessage !== snapshot.message) {
    currentSnapshot = { message: errorMessage, fieldFingerprint };
    setSnapshot(currentSnapshot);
  }

  const routesToField = Boolean(
    errorMessage && isStockError(errorMessage),
  );
  const inlineError =
    routesToField &&
    currentSnapshot.fieldFingerprint === fieldFingerprint
      ? errorMessage
      : undefined;

  return {
    inlineError,
    footerError: routesToField ? undefined : errorMessage,
  };
}
