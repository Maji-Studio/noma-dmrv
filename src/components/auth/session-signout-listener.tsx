"use client";

import { useEffect } from "react";
import { AUTH_SIGNED_OUT_STORAGE_KEY } from "@/lib/auth/client";

/** Drops protected client state in other tabs when one tab signs out. */
export function SessionSignOutListener() {
  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === AUTH_SIGNED_OUT_STORAGE_KEY) {
        window.location.replace("/login");
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return null;
}
