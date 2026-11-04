"use client";

import { useRef } from "react";
import { useMutation, type UseMutationOptions } from "@tanstack/react-query";

/** One draft per hook instance. Read and rotate only in mutation/event callbacks. */
export function useCreateIntentKey() {
  const key = useRef<string | undefined>(undefined);
  return {
    current(): string {
      key.current ??= crypto.randomUUID();
      return key.current;
    },
    rotate(): void {
      key.current = crypto.randomUUID();
    },
  };
}

/** Callers throw failed ActionResults. Keep their key until success or startDraft; rotate before onSuccess. */
export function useIntentMutation<TData = unknown, TError = Error, TVariables = void, TOnMutateResult = unknown>(
  { mutationFn, onSuccess, ...options }: Omit<UseMutationOptions<TData, TError, TVariables, TOnMutateResult>, "mutationFn"> & {
    mutationFn: (variables: TVariables, intentKey: string) => Promise<TData>;
  },
) {
  const intent = useCreateIntentKey();
  const mutation = useMutation<TData, TError, TVariables, TOnMutateResult>({
    ...options,
    mutationFn: (variables) => mutationFn(variables, intent.current()),
    onSuccess: (...args) => {
      intent.rotate();
      return onSuccess?.(...args);
    },
  });
  return { ...mutation, startDraft: intent.rotate };
}
