"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { FormDetailToggle, type FormDetailLevel } from "./form-detail-toggle";

const FormDetailContext = createContext<{
  level: FormDetailLevel;
  setLevel: (level: FormDetailLevel) => void;
} | null>(null);

interface FormDetailProviderProps {
  scope: string;
  children: ReactNode;
  enabled?: boolean;
}

/** Scope changes reset presentation without remounting fields or upload queues. */
export function FormDetailProvider({
  scope,
  children,
  enabled = true,
}: FormDetailProviderProps) {
  const [state, setState] = useState<{ scope: string; level: FormDetailLevel }>({
    scope,
    level: "simple",
  });
  if (state.scope !== scope) setState({ scope, level: "simple" });
  const level = state.scope === scope ? state.level : "simple";
  return (
    <FormDetailContext.Provider
      value={enabled ? {
        level,
        setLevel: (next) => setState({ scope, level: next }),
      } : null}
    >
      {children}
    </FormDetailContext.Provider>
  );
}

/** Unmanaged surfaces retain their existing expanded presentation. */
export function useFormDetailLevel(): FormDetailLevel {
  return useContext(FormDetailContext)?.level ?? "detailed";
}

export function FormDetailControl() {
  const context = useContext(FormDetailContext);
  return context ? <FormDetailToggle value={context.level} onChange={context.setLevel} /> : null;
}

/**
 * Marks an explanation block: content only Detailed renders. The R1 parity
 * guard (`form-detail-parity.test.tsx`) skips anything under this attribute
 * when it compares Simple with Detailed.
 */
export const DETAIL_EXPLANATION_ATTR = "data-detail-explanation";

/**
 * Explanation that only Detailed shows: calculation rows, basis captions,
 * formula or component provenance, raw versus capped values.
 *
 * Simple and Detailed show the same information (R1): never wrap an input, a
 * read field, a section, an action (history links, uploads, add buttons) or
 * anything that informs a decision (available stock, before and after,
 * matching bins, blockers, warnings). Those render at both levels.
 */
export function DetailedOnly({ children }: { children: ReactNode }) {
  return useFormDetailLevel() === "detailed"
    ? <div {...{ [DETAIL_EXPLANATION_ATTR]: true }} className="contents">{children}</div>
    : null;
}
