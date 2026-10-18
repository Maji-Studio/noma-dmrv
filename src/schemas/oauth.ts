import { z } from "zod";
import { expectedVersionSchema } from "./helpers";

export const oauthQuerySchema = z.object({ oauthQuery: z.string().min(1) });
export const selectOAuthOrganizationSchema = oauthQuerySchema.extend({ organizationId: z.string().min(1) }).strict();
export const revokeOAuthGrantSchema = z.object({ id: z.string().min(1), expectedVersion: expectedVersionSchema }).strict();
export type RevokeOAuthGrantInput = z.infer<typeof revokeOAuthGrantSchema>;
