import { describe, expect, it } from "vitest";
import { CERTIFIER_CREDENTIAL_MASK, maskedSecretDisplay } from "@/schemas/organizations";
import {
  NOTHING_CHANGED_MESSAGE,
  resolveCredentialSubmission,
} from "./organization-certifier-credentials";

describe("maskedSecretDisplay", () => {
  it("shows exactly four bullets followed by the saved suffix", () => {
    expect(maskedSecretDisplay("Uwhl")).toBe("••••Uwhl");
  });

  it.each([undefined, null, ""])("shows exactly eight bullets without a suffix (%s)", (last4) => {
    expect(maskedSecretDisplay(last4)).toBe("••••••••");
  });
});

describe("resolveCredentialSubmission (Replace / Keep saved key contract)", () => {
  it("sends only the replaced key; the untouched one stays undefined", () => {
    // Replace access token clears it to "", the operator types, the secret keeps its mask.
    expect(
      resolveCredentialSubmission({
        accessToken: " new-token ",
        clientSecret: CERTIFIER_CREDENTIAL_MASK,
      }),
    ).toEqual({ ok: true, accessToken: "new-token", clientSecret: undefined });
  });

  it("refuses to save when Replace was followed by Keep saved key", () => {
    // Keep saved key restores the mask, so nothing is left to send.
    expect(
      resolveCredentialSubmission({
        accessToken: CERTIFIER_CREDENTIAL_MASK,
        clientSecret: CERTIFIER_CREDENTIAL_MASK,
      }),
    ).toEqual({ ok: false, message: NOTHING_CHANGED_MESSAGE });
  });

  it("treats a cleared, never-retyped key as untouched", () => {
    expect(
      resolveCredentialSubmission({ accessToken: "", clientSecret: "" }),
    ).toEqual({ ok: false, message: NOTHING_CHANGED_MESSAGE });
  });

  it("names the Replace flow in the message", () => {
    expect(NOTHING_CHANGED_MESSAGE).toContain("Replace");
  });
});
