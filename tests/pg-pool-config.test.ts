import { describe, expect, it } from "vitest";
import { getPgPoolConfig } from "@/lib/pg-pool-config";

describe("getPgPoolConfig", () => {
  it("disables SSL for localhost connections", () => {
    const config = getPgPoolConfig(
      "postgresql://postgres:postgres@localhost:5432/noma_dmrv_dev?sslmode=require"
    );

    expect(config.connectionString).toBe(
      "postgresql://postgres:postgres@localhost:5432/noma_dmrv_dev"
    );
    expect(config.ssl).toBe(false);
  });

  it("enables relaxed SSL for remote connections", () => {
    const config = getPgPoolConfig(
      "postgresql://app:secret@db.example.com:5432/noma_dmrv_prod?sslmode=require"
    );

    expect(config.connectionString).toBe(
      "postgresql://app:secret@db.example.com:5432/noma_dmrv_prod"
    );
    expect(config.ssl).toEqual({ rejectUnauthorized: false });
  });
});
