/**
 * SignOutAndReturn — ends the current session, then sends the visitor back to
 * a path (the invitation link), reusing the sidebar's sign-out sequence.
 */
"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { AUTH_SIGNED_OUT_STORAGE_KEY, useAuth } from "@/lib/auth/client";

export function SignOutAndReturn({
  returnTo,
  children,
}: {
  returnTo: string;
  children: ReactNode;
}) {
  const { signOut } = useAuth();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (pending) return;
    setPending(true);
    setError("");
    const result = await signOut();
    if (!result.success) {
      setError(result.error ?? "You could not be signed out. Try again.");
      setPending(false);
      return;
    }
    try {
      localStorage.setItem(AUTH_SIGNED_OUT_STORAGE_KEY, String(Date.now()));
    } catch {
      // A full navigation still clears this tab.
    }
    window.location.replace(returnTo);
  }

  return (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      <Button
      type="button"
      variant="primary"
      width="full"
      onClick={handleClick}
      busy={pending}
    >
      {children}
      </Button>
    </>
  );
}
