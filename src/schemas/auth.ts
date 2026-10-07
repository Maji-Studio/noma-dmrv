import { z } from "zod";
import { AUTH_PASSWORD_MIN_LENGTH, AUTH_PASSWORD_MAX_LENGTH } from "@/config/auth";

const passwordSchema = z
  .string()
  .min(AUTH_PASSWORD_MIN_LENGTH, `Password must be at least ${AUTH_PASSWORD_MIN_LENGTH} characters`)
  .max(AUTH_PASSWORD_MAX_LENGTH, `Password must be at most ${AUTH_PASSWORD_MAX_LENGTH} characters`);

/**
 * Schema for login form
 */
export const loginSchema = z.object({
  email: z.string().email({ message: "Enter a valid email address." }),
  password: passwordSchema,
});

/**
 * Schema for forgot password form
 */
export const forgotPasswordSchema = z.object({
  email: z.string().email({ message: "Enter a valid email address." }),
});

/**
 * Schema for set password form (new user invitation)
 * Includes cross-field validation for password matching
 */
export const setPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: passwordSchema,
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

/**
 * Schema for reset password form (forgot password flow)
 * Same as setPasswordSchema but semantically different
 */
export const resetPasswordSchema = z
  .object({
    newPassword: passwordSchema,
    confirmPassword: passwordSchema,
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

/**
 * Type inference for auth forms
 */
export type LoginFormData = z.infer<typeof loginSchema>;
export type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;
export type SetPasswordFormData = z.infer<typeof setPasswordSchema>;
export type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;
