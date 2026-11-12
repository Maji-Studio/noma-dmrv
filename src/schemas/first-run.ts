import { z } from "zod";
import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH } from "@/config/auth";

export const firstAdminSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  password: z.string()
    .min(AUTH_PASSWORD_MIN_LENGTH, `Use at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`)
    .max(AUTH_PASSWORD_MAX_LENGTH, `Use at most ${AUTH_PASSWORD_MAX_LENGTH} characters.`),
});

export type FirstAdminInput = z.infer<typeof firstAdminSchema>;

/** The setup form asks for the password twice; the action itself takes only the base fields. */
export const firstAdminFormSchema = firstAdminSchema
  .extend({ confirmPassword: z.string() })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type FirstAdminFormData = z.infer<typeof firstAdminFormSchema>;
