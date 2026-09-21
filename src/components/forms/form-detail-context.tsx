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

/** Only wrap optional, stateless explanation; never fields, warnings or evidence editors. */
export function DetailedOnly({ children }: { children: ReactNode }) {
  return useFormDetailLevel() === "detailed" ? children : null;
}
