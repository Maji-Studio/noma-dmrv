/**
 * Authentication types
 * Shared types for auth functionality
 */

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: "user" | "admin";
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Session {
  id: string;
  userId: string;
  expiresAt: Date;
}

export interface AuthContext {
  user: User | null;
  session: Session | null;
}
