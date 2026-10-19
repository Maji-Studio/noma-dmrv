"use client";

import { useSyncExternalStore } from "react";
import { currentOAuthQuery } from "@/lib/auth/oauth-continuation";

const subscribeNever = () => () => undefined;

/**
 * The signed query of the current OAuth page. `null` on the server and during
 * hydration (there is no window yet), the string once the client has it; an
 * empty string means the page was opened without a query.
 */
export function useOAuthQuery(): string | null {
  return useSyncExternalStore(subscribeNever, currentOAuthQuery, () => null);
}
