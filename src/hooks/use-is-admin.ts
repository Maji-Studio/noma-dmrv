/**
 * useIsAdmin — hydration-safe client-side admin check.
 *
 * The Better Auth session resolves synchronously on the client (cookie cache)
 * but is unresolved during SSR, so gating UI on it directly would render a
 * subtree on the client that the server never produced — a hydration mismatch.
 * `useSyncExternalStore` returns the server snapshot (false) during SSR and the
 * first client render, then the client snapshot (true) once hydrated, so admin
 * affordances only appear after hydration and match the server on first paint.
 *
 * This is a UX gate ONLY — every privileged server action still calls
 * `requireAdminAction()` (and admin routes call `requireAdmin()`); those remain
 * the real access boundary. `role` is a Better Auth additionalField absent from
 * the inferred client user type, so it is asserted the same way the auth
 * provider layer does.
 */
"use client";

import { useSyncExternalStore } from "react";
import { authClient } from "@/lib/auth/client";

const subscribeNoop = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function useIsAdmin(): boolean {
  const { data: session } = authClient.useSession();
  const hydrated = useSyncExternalStore(
    subscribeNoop,
    getClientSnapshot,
    getServerSnapshot,
  );
  const role = (session?.user as { role?: string } | undefined)?.role;
  return hydrated && role === "admin";
}
