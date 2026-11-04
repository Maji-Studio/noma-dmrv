// Deliberately not a "use server" module: `withCreate` is a helper that
// action modules import, not an action the browser may call.
import type { z } from "zod";
import type { OrgContext } from "@/lib/auth/server";
import { runOperationInProcess, type Operation, type OperationEffect } from "@/lib/operations/runner";
import { createIntentOptionsSchema, type CreateIntentOptions } from "@/schemas/create-intent";
import type { ActionResult } from "@/types/actions";
import { withAction, type MappedFailure, type WithActionOptions } from "./with-action";

export interface KeyedCreate {
  <I extends z.ZodType, O>(operation: Operation<I, O, OperationEffect | undefined>, input: unknown): Promise<O>;
  /** Parsed key for API key creation, which replaces an unseen secret on retry. */
  readonly key: string | undefined;
}

/** Resolve auth through withAction and parse retry options only after payload validation. */
export function withCreate<T, E extends MappedFailure = never>(
  fn: (ctx: OrgContext, create: KeyedCreate) => Promise<T>,
  intent: CreateIntentOptions | undefined,
  options?: WithActionOptions<E>,
): Promise<ActionResult<T> | E> {
  return withAction((ctx) => {
    let parsed = false;
    let parsedIntent: CreateIntentOptions;
    let called = false;
    const parseIntent = () => {
      if (!parsed) {
        parsedIntent = parseCreateIntent(intent);
        parsed = true;
      }
      return parsedIntent;
    };
    const create: KeyedCreate = Object.defineProperty(
      async <I extends z.ZodType, O>(operation: Operation<I, O, OperationEffect | undefined>, input: unknown) => {
        if (called) throw new Error("A create action may run only one operation.");
        called = true;
        const parsedOptions = parseIntent();
        return runOperationInProcess(operation, ctx, input, parsedOptions);
      },
      "key",
      { get: () => parseIntent()?.intentKey },
    ) as KeyedCreate;
    return fn(ctx, create);
  }, options);
}

/**
 * The parsed retry key for a create that runs outside an organization, so
 * neither `withCreate` (it needs an OrgContext) nor the operation runner can
 * hold it: the Platform's organization create, which keys its own replay by
 * using the key as the new organization's id. Call it after the payload parse,
 * like `withCreate` does, so a bad payload is refused before the key is read.
 */
export function parseCreateIntentKey(intent: CreateIntentOptions | undefined): string | undefined {
  return parseCreateIntent(intent)?.intentKey;
}

/** The one parse of create retry options, shared by `withCreate` and `parseCreateIntentKey`. */
function parseCreateIntent(intent: CreateIntentOptions | undefined): CreateIntentOptions {
  return createIntentOptionsSchema.parse(intent);
}
