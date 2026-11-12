import { readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPgPoolConfig } from "@/lib/pg-pool-config";
import { assertThrowawayTestDatabase } from "./helpers/throwaway-database";

const DEFAULT_ORG_ID = "org_dark_earth_carbon";
const OTHER_ORG_ID = "other-organization";
const schema = `plain_setup_${crypto.randomUUID().replaceAll("-", "")}`;
const client = new Client(getPgPoolConfig(process.env.DATABASE_URL!));
// Execute the real migration with only its public schema qualifiers relocated.
// Minimal isolated tables include cascading FKs so the test cannot pass merely
// because PostgreSQL refuses the DELETE. No public data is read or changed.
const migration = readFileSync("drizzle/0178_remove_unused_default_organization.sql", "utf8")
  .replaceAll("public.", `"${schema}".`);

beforeAll(async () => {
  assertThrowawayTestDatabase(process.env.DATABASE_URL!);
  await client.connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`
    CREATE TABLE "${schema}".organizations (id text PRIMARY KEY, slug text UNIQUE, UNIQUE (slug, id));
    CREATE TABLE "${schema}".users (id text PRIMARY KEY, last_active_organization_id text);
    CREATE TABLE "${schema}".session (id text PRIMARY KEY, active_organization_id text);
    CREATE TABLE "${schema}".members (
      id text PRIMARY KEY,
      organization_id text REFERENCES "${schema}".organizations(id) ON DELETE CASCADE
    );
    CREATE TABLE "${schema}"."organization data" (
      id text PRIMARY KEY,
      org_slug text,
      "owner id" text,
      FOREIGN KEY (org_slug, "owner id") REFERENCES "${schema}".organizations(slug, id) ON DELETE CASCADE
    );
  `);
});

beforeEach(async () => {
  await client.query(`TRUNCATE "${schema}".members, "${schema}"."organization data", "${schema}".session, "${schema}".users, "${schema}".organizations`);
  await client.query(`INSERT INTO "${schema}".organizations (id, slug) VALUES ($1, 'default'), ($2, 'other')`, [DEFAULT_ORG_ID, OTHER_ORG_ID]);
});

afterAll(async () => {
  try {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await client.end();
  }
});

async function organizationIds() {
  const { rows } = await client.query<{ id: string }>(`SELECT id FROM "${schema}".organizations ORDER BY id`);
  return rows.map(row => row.id);
}

describe("plain setup cleanup migration (real database)", () => {
  it("deletes only the unreferenced default organization and is repeatable", async () => {
    await client.query(`INSERT INTO "${schema}".members (id, organization_id) VALUES ('other-member', $1)`, [OTHER_ORG_ID]);
    await client.query(migration);
    expect(await organizationIds()).toEqual([OTHER_ORG_ID]);
    await client.query(migration);
    expect(await organizationIds()).toEqual([OTHER_ORG_ID]);
  });

  it("keeps the organization and its member despite a cascading FK", async () => {
    await client.query(`INSERT INTO "${schema}".members (id, organization_id) VALUES ('member', $1)`, [DEFAULT_ORG_ID]);
    await client.query(migration);
    expect(await organizationIds()).toEqual([DEFAULT_ORG_ID, OTHER_ORG_ID]);
    const { rows } = await client.query(`SELECT id FROM "${schema}".members`);
    expect(rows).toEqual([{ id: "member" }]);
  });

  it("discovers org-scoped data with a composite FK and quoted identifiers", async () => {
    await client.query(`INSERT INTO "${schema}"."organization data" (id, org_slug, "owner id") VALUES ('data', 'default', $1)`, [DEFAULT_ORG_ID]);
    await client.query(migration);
    expect(await organizationIds()).toEqual([DEFAULT_ORG_ID, OTHER_ORG_ID]);
    const { rows } = await client.query(`SELECT id FROM "${schema}"."organization data"`);
    expect(rows).toEqual([{ id: "data" }]);
  });

  it.each([
    ["users", "last_active_organization_id"],
    ["session", "active_organization_id"],
  ])("keeps an organization referenced by %s.%s without an FK", async (table, column) => {
    await client.query(`INSERT INTO "${schema}"."${table}" (id, "${column}") VALUES ('preference', $1)`, [DEFAULT_ORG_ID]);
    await client.query(migration);
    expect(await organizationIds()).toEqual([DEFAULT_ORG_ID, OTHER_ORG_ID]);
  });
});
