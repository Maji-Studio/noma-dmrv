import { env } from "@/config/env";

export function getEmailAppUrl(): string {
  return env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
}
