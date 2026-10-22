"use server";

import * as credentials from "@/data-access/api-keys";
import { revokeApiKeySchema, createApiKeySchema, updateApiKeySchema } from "@/schemas/api-keys";
import type { CreateIntentOptions } from "@/schemas/create-intent";
import { withAction } from "./with-action";
import { withCreate } from "./with-create";

export async function listApiKeysFn() {
  return withAction((ctx) => credentials.listApiKeys(ctx));
}
export async function createApiKeyFn(input: unknown, options?: CreateIntentOptions) {
  return withCreate((ctx, create) => credentials.createApiKey(ctx, createApiKeySchema.parse(input), create.key), options);
}
export async function updateApiKeyFn(input: unknown) {
  return withAction((ctx) => credentials.updateApiKey(ctx, updateApiKeySchema.parse(input)));
}
export async function revokeApiKeyFn(input: unknown) {
  return withAction((ctx) => credentials.revokeApiKey(ctx, revokeApiKeySchema.parse(input)));
}
