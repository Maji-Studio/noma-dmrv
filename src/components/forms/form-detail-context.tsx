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
 * How much of a derived block Simple shows. Detailed, and any surface outside a
 * provider, shows the whole block.
 *
 * - `picture`: caption, headline and the picture (a bar and its key).
 * - `headline`: caption and the headline figure.
 * - `hidden`: nothing.
 */
export type SimplePresence = "hidden" | "headline" | "picture";

/** Which parts of a derived block show at the current level. */
export function useSimplePresence(simple: SimplePresence): {
  /** The block renders at all. */
  block: boolean;
  /** The picture under the headline renders. */
  picture: boolean;
  /** Detailed: detail rows, the action row and the calculation render too. */
  detailed: boolean;
} {
  const detailed = useFormDetailLevel() === "detailed";
  return {
    block: detailed || simple !== "hidden",
    picture: detailed || simple === "picture",
    detailed,
  };
}

/** Only wrap optional, stateless explanation; never fields, warnings or evidence editors. */
export function DetailedOnly({ children }: { children: ReactNode }) {
  return useFormDetailLevel() === "detailed" ? children : null;
}
