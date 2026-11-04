/**
 * The server's feature switches, handed to client components. The switch
 * accessors read off in the browser, so the app layout reads them on the
 * server and passes the values down. Controls that would only lead to a
 * refusal read them here and stay hidden. Everything defaults to off.
 */
"use client";

import { createContext, useContext, type ReactNode } from "react";

export interface FeatureSwitches {
  mcp: boolean;
  stockAdjustments: boolean;
  multiBinRuns: boolean;
}

const ALL_OFF: FeatureSwitches = { mcp: false, stockAdjustments: false, multiBinRuns: false };

const FeatureSwitchesContext = createContext<FeatureSwitches>(ALL_OFF);

export function FeatureSwitchesProvider({ value, children }: { value: FeatureSwitches; children: ReactNode }) {
  return <FeatureSwitchesContext.Provider value={value}>{children}</FeatureSwitchesContext.Provider>;
}

export function useFeatureSwitches(): FeatureSwitches {
  return useContext(FeatureSwitchesContext);
}
