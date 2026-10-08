import { describe, expect, it } from "vitest";
import { parseApiCredential } from "./api-credential-header";

describe("API credential headers", () => {
  it.each(["Bearer", "Basic value", "Bearer a b", "Bearer  value", "Bearer value\tother"])("rejects %s", (authorization) => {
    expect(parseApiCredential(new Headers({ authorization }))).toEqual({ ok: false, denial: "credential_malformed" });
  });
  it("rejects duplicate bearer headers", () => {
    const headers = new Headers();
    headers.append("authorization", "Bearer first"); headers.append("authorization", "Bearer second");
    expect(parseApiCredential(headers)).toEqual({ ok: false, denial: "credential_ambiguous" });
  });
  it("rejects a second header credential", () => {
    expect(parseApiCredential(new Headers({ authorization: "Bearer key", "x-api-key": "key" })))
      .toEqual({ ok: false, denial: "credential_ambiguous" });
  });
  it("does not support x-api-key", () => {
    expect(parseApiCredential(new Headers({ "x-api-key": "key" })))
      .toEqual({ ok: false, denial: "credential_header_unsupported" });
  });
  it("ignores cookies alongside a bearer", () => {
    expect(parseApiCredential(new Headers({ authorization: "bEaReR key", cookie: "session=value" })))
      .toEqual({ ok: true, key: "key" });
  });
  it("refuses cookies alone and never falls back from a bad bearer", () => {
    expect(parseApiCredential(new Headers({ cookie: "session=value" })))
      .toEqual({ ok: false, denial: "cookie_session_unsupported" });
    expect(parseApiCredential(new Headers({ authorization: "bad", cookie: "session=value" })))
      .toEqual({ ok: false, denial: "credential_malformed" });
    expect(parseApiCredential(new Headers())).toEqual({ ok: false, denial: "credential_missing" });
  });
});
