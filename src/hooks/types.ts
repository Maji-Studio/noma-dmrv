/**
 * Shared types for React Query mutation hooks
 */

export interface MutationCallbacks<TData, TVariables> {
  onMutate?: (variables: TVariables) => void | Promise<void>;
  onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>;
  onError?: (error: Error, variables: TVariables) => void | Promise<void>;
  onSettled?: (data: TData | undefined, error: Error | null, variables: TVariables) => void | Promise<void>;
}

export interface OptimisticUpdateOptions {
  /** Enable optimistic updates (default: true for update, false for create/delete) */
  optimistic?: boolean;
}
