import { z } from "zod";
import { passwordSchema } from "@/schemas/auth";

export const FIRST_ADMIN_SETUP_FALLBACK = "Your Platform Admin account could not be created. Try again.";

export const firstAdminSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  password: passwordSchema,
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
