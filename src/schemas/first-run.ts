import { z } from "zod";
import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH } from "@/config/auth";

export const firstAdminSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  password: z.string()
    .min(AUTH_PASSWORD_MIN_LENGTH, `Use at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`)
    .max(AUTH_PASSWORD_MAX_LENGTH, `Use at most ${AUTH_PASSWORD_MAX_LENGTH} characters.`),
});

export type FirstAdminInput = z.infer<typeof firstAdminSchema>;
