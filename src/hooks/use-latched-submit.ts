"use client";

import { useRef } from "react";

/** Hold across RHF validation and the awaited save, before React can re-render. */
export function useLatchedSubmit() {
  const inFlight = useRef(false);

  return function latched<TEvent extends { preventDefault: () => void } | undefined>(
    handler: (event: TEvent) => Promise<unknown> | void,
  ) {
    return async (event: NonNullable<TEvent>) => {
      if (inFlight.current) {
        event.preventDefault();
        return;
      }
      inFlight.current = true;
      try {
        await handler(event);
      } finally {
        // RHF also resolves on invalid input; correcting it must allow a retry.
        inFlight.current = false;
      }
    };
  };
}
