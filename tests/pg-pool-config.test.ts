import { describe, expect, it, afterEach } from "vitest";
import { getPgPoolConfig, isLocalDatabaseTarget } from "@/lib/pg-pool-config";

describe("getPgPoolConfig", () => {
  afterEach(() => {
    delete process.env.PG_ALLOW_UNVERIFIED_SSL;
    delete process.env.DATABASE_CA_CERT;
  });

  it("disables SSL for localhost connections", () => {
    const config = getPgPoolConfig(
      "postgresql://postgres:postgres@localhost:5432/noma_dmrv_dev?sslmode=require"
    );

    expect(config.connectionString).toBe(
      "postgresql://postgres:postgres@localhost:5432/noma_dmrv_dev"
    );
    expect(config.ssl).toBe(false);
  });

  it("enables strict SSL for remote connections by default", () => {
    const config = getPgPoolConfig(
      "postgresql://app:secret@db.example.com:5432/noma_dmrv_prod?sslmode=require"
    );

    expect(config.connectionString).toBe(
      "postgresql://app:secret@db.example.com:5432/noma_dmrv_prod"
    );
    expect(config.ssl).toBe(true);
  });

  it("disables SSL for IPv6 loopback connections", () => {
    expect(getPgPoolConfig("postgresql://postgres@[::1]/app").ssl).toBe(false);
  });

  it("enables relaxed SSL for remote connections when PG_ALLOW_UNVERIFIED_SSL is set", () => {
    process.env.PG_ALLOW_UNVERIFIED_SSL = "true";
    const config = getPgPoolConfig(
      "postgresql://app:secret@db.example.com:5432/noma_dmrv_prod?sslmode=require"
    );

    expect(config.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("pins the provider CA with full verification when DATABASE_CA_CERT is set", () => {
    process.env.DATABASE_CA_CERT =
      "-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----";
    process.env.PG_ALLOW_UNVERIFIED_SSL = "true";
    const config = getPgPoolConfig(
      "postgresql://app:secret@db.example.com:5432/noma_dmrv_prod?sslmode=require"
    );

    expect(config.ssl).toEqual({
      ca: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
      rejectUnauthorized: true,
    });
  });

  it("ignores DATABASE_CA_CERT for local connections", () => {
    process.env.DATABASE_CA_CERT = "-----BEGIN CERTIFICATE-----";
    const config = getPgPoolConfig(
      "postgresql://postgres:postgres@localhost:5432/noma_dmrv_dev"
    );

    expect(config.ssl).toBe(false);
  });
});

describe("isLocalDatabaseTarget", () => {
  it("keeps TLS on when a host override points a localhost URL elsewhere", () => {
    expect(getPgPoolConfig("postgresql://app:secret@localhost/app?host=db.example.com").ssl).toBe(true);
  });

  it.each([
    ["postgresql://postgres@localhost:5432/noma_dmrv_dev", true],
    ["postgresql://postgres@127.0.0.1/noma_dmrv_dev?sslmode=disable", true],
    ["postgresql://postgres@[::1]/app", true],
    ["postgresql://postgres@[::1]/app?host=db.example.com", false],
    ["postgresql://app@db.example.com/noma_dmrv_prod", false],
    ["postgresql://postgres@localhost/app?host=db.example.com", false],
    ["postgresql://postgres@localhost/app?hostaddr=203.0.113.7", false],
    ["postgresql://postgres@localhost/app?host=/var/run/postgresql", true],
    ["postgresql://postgres@localhost/app?hostaddr=127.0.0.1", true],
    ["postgresql://postgres@localhost/app?host=/var/run/postgresql,db.example.com", false],
  ])("classifies %s as local=%s", (databaseUrl, local) => {
    expect(isLocalDatabaseTarget(databaseUrl)).toBe(local);
  });
});
