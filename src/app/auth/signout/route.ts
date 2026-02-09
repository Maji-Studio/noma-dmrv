/**
 * Sign out route handler
 * Handles user sign out and redirects to login
 */
import { NextRequest, NextResponse } from "next/server";
import { signOut } from "@/lib/auth/server";

export async function POST(request: NextRequest) {
  try {
    // Sign out the user
    const result = await signOut();

    if (!result.success) {
      console.error("Sign out error:", result.error);
    }

    // Redirect to login page
    return NextResponse.redirect(new URL("/login", request.url));
  } catch (error) {
    console.error("Sign out error:", error);

    // Still redirect to login even if sign out fails
    return NextResponse.redirect(new URL("/login", request.url));
  }
}
