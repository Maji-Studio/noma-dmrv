import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { oauthProvider } from "@better-auth/oauth-provider";
import * as tables from "@/db/schema/oauth";

const models = {
  oauthClient: tables.oauthClients,
  oauthResource: tables.oauthResources,
  oauthClientResource: tables.oauthClientResources,
  oauthConsent: tables.oauthConsents,
  oauthAccessToken: tables.oauthAccessTokens,
  oauthRefreshToken: tables.oauthRefreshTokens,
  oauthClientAssertion: tables.oauthClientAssertions,
};

describe("OAuth provider storage contract", () => {
  it("maps every installed plugin field with its type, nullability and default", () => {
    const schema = oauthProvider({ disableJwtPlugin: true, loginPage: "/login", consentPage: "/consent" }).schema!;
    for (const [model, table] of Object.entries(models)) {
      const fields = schema[model as keyof typeof models].fields;
      const columns = getTableColumns(table);
      expect(Object.keys(columns).sort()).toEqual(["id", ...Object.keys(fields)].sort());
      for (const [name, field] of Object.entries(fields)) {
        const column = columns[name as keyof typeof columns];
        expect(column.name).toBe(name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase());
        const required = model === "oauthConsent" && name === "referenceId" || field.required !== false;
        expect(column.notNull, `${model}.${name}`).toBe(required);
        const types = { string: "text", "string[]": "text[]", date: "timestamp", boolean: "boolean", number: "integer", json: "jsonb" };
        expect(column.getSQLType()).toBe(types[field.type as keyof typeof types]);
        expect(column.default).toEqual(field.defaultValue);
      }
    }
  });
});

it("keeps session deletion separate from generation revocation", () => {
  for (const table of [tables.oauthAccessTokens, tables.oauthRefreshTokens]) {
    const fks = getTableConfig(table).foreignKeys;
    expect(fks.find(fk => fk.reference().columns[0].name === "session_id")?.onDelete).toBe("set null");
    const reference = fks.find(fk => fk.reference().columns[0].name === "reference_id");
    expect(reference?.reference().foreignTable).toBe(tables.oauthGrants);
    expect(reference?.onDelete).toBe("cascade");
  }
  const member = getTableConfig(tables.oauthGrants).foreignKeys.find(fk => fk.reference().columns[0].name === "member_id");
  expect(member?.onDelete).toBe("set null");
});

it("makes active generations and consent bindings unique", () => {
  const active = getTableConfig(tables.oauthGrants).indexes.find(index => index.config.name === "oauth_grants_active_binding_unique")!;
  expect(active.config.unique).toBe(true);
  expect(active.config.columns.map(column => "name" in column ? column.name : null)).toEqual(["organization_id", "user_id", "client_id", "resource"]);
  const where = new PgDialect().sqlToQuery(active.config.where!);
  expect(where.sql).toContain('"revoked_at" is null');
  const consent = getTableConfig(tables.oauthConsents).indexes.find(index => index.config.name === "oauth_consents_client_user_reference_unique")!;
  expect(consent.config.unique).toBe(true);
  expect(consent.config.columns.map(column => "name" in column ? column.name : null)).toEqual(["client_id", "user_id", "reference_id"]);
});

it("restricts revocation reasons to the supported lifecycle values", () => {
  const constraint = getTableConfig(tables.oauthGrants).checks.find(check => check.name === "oauth_grants_revocation_reason_check");
  expect(constraint).toBeDefined();
  const query = new PgDialect().sqlToQuery(constraint!.value);
  expect(query.sql).toContain(`in ('disconnected', 'member_changed', 'member_removed', 'refresh_reuse', 'client_revoked', 'inactive', 'expired')`);
  expect(query.params).toEqual([]);
});
