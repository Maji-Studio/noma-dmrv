"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { isCreateIntentValue } from "@/lib/create-intent";

export interface OpenCreateIntentOptions {
  initialOpen?: boolean;
  contextParam?: string;
  initialContext?: string | null;
}

/**
 * Owns create deep-link state without depending on a caller callback's identity.
 * Server pages pass `initialOpen` (and optional context) so hard entries render
 * the create sheet immediately; the effect only captures client navigations and
 * consumes the handled query parameters.
 */
export function useOpenCreateIntent(
  optionsOrLegacyCallback: OpenCreateIntentOptions | (() => void) = {},
) {
  const legacyCallback =
    typeof optionsOrLegacyCallback === "function"
      ? optionsOrLegacyCallback
      : null;
  const initialOpen =
    typeof optionsOrLegacyCallback === "function"
      ? false
      : (optionsOrLegacyCallback.initialOpen ?? false);
  const contextParam =
    typeof optionsOrLegacyCallback === "function"
      ? undefined
      : optionsOrLegacyCallback.contextParam;
  const initialContext =
    typeof optionsOrLegacyCallback === "function"
      ? null
      : (optionsOrLegacyCallback.initialContext ?? null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const handledRef = useRef(false);
  const [intent, setIntent] = useState<{ context: string | null } | null>(() =>
    initialOpen ? { context: initialContext } : null,
  );

  useEffect(() => {
    const shouldOpen = isCreateIntentValue(searchParams.get("create"));

    if (!shouldOpen) {
      handledRef.current = false;
      return;
    }

    if (handledRef.current) {
      return;
    }

    handledRef.current = true;
    if (legacyCallback) {
      legacyCallback();
    } else {
      const context = contextParam ? searchParams.get(contextParam) : null;
      queueMicrotask(() => setIntent({ context }));
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("create");
    if (contextParam) {
      nextParams.delete(contextParam);
    }
    const nextQuery = nextParams.toString();

    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
      scroll: false,
    });
  }, [contextParam, legacyCallback, pathname, router, searchParams]);

  return {
    isOpen: intent !== null,
    context: intent?.context ?? null,
    clear: () => setIntent(null),
  };
}
