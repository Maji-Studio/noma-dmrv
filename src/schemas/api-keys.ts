import { z } from "zod";
import { expectedVersionSchema, toIntOrNull } from "./helpers";
import { API_KEY_MAX_EXPIRY_SECONDS, API_KEY_NAME_MAX_LENGTH } from "@/config/api-keys";
import { API_SCOPES } from "@/lib/auth/api-scopes";

const name = z.string().trim()
  .min(1, "Enter a name for this API key.")
  .max(API_KEY_NAME_MAX_LENGTH, `Use ${API_KEY_NAME_MAX_LENGTH} characters or fewer.`);
const scopes = z.array(z.enum(API_SCOPES)).max(API_SCOPES.length);
export const createApiKeySchema = z.strictObject({
  name, scopes,
  // Required even though the plugin also has a defensive default.
  expiresIn: z.preprocess(toIntOrNull, z.number().int().positive().max(API_KEY_MAX_EXPIRY_SECONDS)),
});
export const apiKeyIdSchema = z.strictObject({ id: z.string().min(1) });
export const revokeApiKeySchema = apiKeyIdSchema.extend({ expectedVersion: expectedVersionSchema });
export const updateApiKeySchema = revokeApiKeySchema.extend({ name, scopes });
export type RevokeApiKeyInput = z.infer<typeof revokeApiKeySchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type UpdateApiKeyInput = z.infer<typeof updateApiKeySchema>;

export type CreateApiKeyFormInput = z.input<typeof createApiKeySchema>;
