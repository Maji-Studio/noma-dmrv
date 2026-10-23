/**
 * SignOutAndReturn — ends the current session, then sends the visitor back to
 * a path (the invitation link), reusing the sidebar's sign-out sequence.
 */
"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { PHONE_TOUCH_TARGET } from "@/components/ui/touch-target";
import { AUTH_SIGNED_OUT_STORAGE_KEY, useAuth } from "@/lib/auth/client";

interface SignOutDeps {
  signOut: () => Promise<{ success: boolean; error?: string }>;
  setStorageItem: (key: string, value: string) => void;
  replace: (url: string) => void;
}

/**
 * Sign out, then leave. Only a confirmed sign-out broadcasts to other tabs and
 * navigates; on failure the session is still live, so it returns the error.
 */
export async function signOutAndReturn(
  returnTo: string,
  { signOut, setStorageItem, replace }: SignOutDeps,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await signOut();
  if (!result.success) {
    return {
      ok: false,
      error: result.error ?? "You could not be signed out. Try again.",
    };
  }
  try {
    setStorageItem(AUTH_SIGNED_OUT_STORAGE_KEY, String(Date.now()));
  } catch {
    // A full navigation still clears this tab.
  }
  replace(returnTo);
  return { ok: true };
}

export function SignOutAndReturn({
  returnTo,
  children,
  compact = false,
}: {
  returnTo: string;
  children: ReactNode;
  /** Small default button, for actions inside a Notice. A failure shows as a caption, since a Notice may not nest in a Notice. */
  compact?: boolean;
}) {
  const { signOut } = useAuth();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (pending) return;
    setPending(true);
    setError("");
    const outcome = await signOutAndReturn(returnTo, {
      signOut,
      setStorageItem: (key, value) => localStorage.setItem(key, value),
      replace: (url) => window.location.replace(url),
    });
    if (!outcome.ok) {
      setError(outcome.error);
      setPending(false);
    }
  }

  return (
    <>
      {error && !compact && <Notice tone="error">{error}</Notice>}
      <Button
        type="button"
        variant={compact ? "default" : "primary"}
        size={compact ? "small" : undefined}
        className={compact ? PHONE_TOUCH_TARGET : undefined}
        width={compact ? undefined : "full"}
        onClick={handleClick}
        busy={pending}
      >
        {children}
      </Button>
      {error && compact && (
        <p role="alert" className="caption mt-8 text-[var(--color-text-secondary)]">{error}</p>
      )}
    </>
  );
}
