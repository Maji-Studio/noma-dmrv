import { createIsometricClient, ISOMETRIC_BASE_URLS } from "@/lib/isometric/client";

export function testIsometricClient() {
  return createIsometricClient({
    clientSecret: "test-secret",
    accessToken: "test-token",
    baseUrl: ISOMETRIC_BASE_URLS.sandbox,
  });
}
