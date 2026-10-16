"use client";

/**
 * Which form is on screen carries CERT fields? The answer is derived from the
 * chips the form actually renders, so no form keeps a flag of its own.
 *
 * A sheet wraps its header and body in `RequirednessLegendProvider`. Every CERT
 * chip a form draws (`FormField`, `SectionLabel`) mounts a
 * `RequirednessLegendSource` beside it, which counts itself in while mounted.
 * `RequirednessLegendHint` (the sheet header) shows while the count is above
 * zero. A dialog is its own scope and re-provides `null`.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

interface RequirednessLegendScope {
  /** CERT chips currently mounted in this scope. */
  certFieldCount: number;
  countCertField: Dispatch<SetStateAction<number>>;
}

export const RequirednessLegendContext =
  createContext<RequirednessLegendScope | null>(null);

export function RequirednessLegendProvider({ children }: { children: ReactNode }) {
  const [certFieldCount, countCertField] = useState(0);
  return (
    <RequirednessLegendContext.Provider value={{ certFieldCount, countCertField }}>
      {children}
    </RequirednessLegendContext.Provider>
  );
}

/** True while the surrounding sheet shows at least one CERT chip. */
export function useHasCertFields(): boolean {
  return (useContext(RequirednessLegendContext)?.certFieldCount ?? 0) > 0;
}

/** Renders nothing. Mount it next to a CERT chip so the sheet knows about it. */
export function RequirednessLegendSource() {
  const countCertField = useContext(RequirednessLegendContext)?.countCertField;
  // Imperative registration with the surrounding sheet (sanctioned effect).
  useEffect(() => {
    if (!countCertField) return;
    countCertField((count) => count + 1);
    return () => countCertField((count) => count - 1);
  }, [countCertField]);
  return null;
}
