import { config } from 'dotenv';
import { isTable } from 'drizzle-orm';
import { getTableConfig, isPgEnum } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import * as schema from '../../db/schema';

config({ path: '.env.local' });

const POSTGRES_MAX_IDENTIFIER_LENGTH = 63;

type ExpectedColumn = {
  schemaName: string;
  tableName: string;
  columnName: string;
  isNullable: boolean;
};

type ExpectedTable = {
  schemaName: string;
  tableName: string;
  columns: Map<string, ExpectedColumn>;
};

type ExpectedEnum = {
  schemaName: string;
  enumName: string;
  values: string[];
};

type ExpectedCheck = {
  schemaName: string;
  tableName: string;
  checkName: string;
};

type LiveColumnRow = {
  table_schema: string;
  table_name: string;
  column_name: string;
  is_nullable: 'YES' | 'NO';
};

type LiveEnumRow = {
  schema_name: string;
  enum_name: string;
  enum_label: string;
};

type LiveCheckRow = {
  table_schema: string;
  table_name: string;
  constraint_name: string;
};

function getExpectedTables(): Map<string, ExpectedTable> {
  const tables = new Map<string, ExpectedTable>();

  for (const entity of Object.values(schema)) {
    if (!isTable(entity)) {
      continue;
    }

    const table = getTableConfig(entity);
    const schemaName = table.schema ?? 'public';
    const key = `${schemaName}.${table.name}`;

    tables.set(key, {
      schemaName,
      tableName: table.name,
      columns: new Map(
        table.columns.map((column) => [
          column.name,
          {
            schemaName,
            tableName: table.name,
            columnName: column.name,
            isNullable: !column.notNull,
          },
        ])
      ),
    });
  }

  return tables;
}

function getExpectedEnums(): Map<string, ExpectedEnum> {
  const enums = new Map<string, ExpectedEnum>();

  for (const entity of Object.values(schema)) {
    if (!isPgEnum(entity)) {
      continue;
    }

    const schemaName = entity.schema ?? 'public';
    const key = `${schemaName}.${entity.enumName}`;

    enums.set(key, {
      schemaName,
      enumName: entity.enumName,
      values: [...entity.enumValues],
    });
  }

  return enums;
}

function getExpectedChecks(): Map<string, Map<string, ExpectedCheck>> {
  const checks = new Map<string, Map<string, ExpectedCheck>>();

  for (const entity of Object.values(schema)) {
    if (!isTable(entity)) {
      continue;
    }

    const table = getTableConfig(entity);
    const schemaName = table.schema ?? 'public';
    const tableKey = `${schemaName}.${table.name}`;
    const tableChecks = new Map<string, ExpectedCheck>();

    for (const checkConstraint of table.checks) {
      const normalizedCheckName = normalizeConstraintName(checkConstraint.name);

      tableChecks.set(normalizedCheckName, {
        schemaName,
        tableName: table.name,
        checkName: normalizedCheckName,
      });
    }

    checks.set(tableKey, tableChecks);
  }

  return checks;
}

function normalizeConstraintName(name: string): string {
  return name.slice(0, POSTGRES_MAX_IDENTIFIER_LENGTH);
}

function isGeneratedNotNullCheck(name: string): boolean {
  return /^\d+_\d+_\d+_not_null$/.test(name);
}

async function verifySchema(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const expectedTables = getExpectedTables();
  const expectedEnums = getExpectedEnums();
  const expectedChecks = getExpectedChecks();
  const schemaNames = [...new Set([
    ...[...expectedTables.values()].map((table) => table.schemaName),
    ...[...expectedEnums.values()].map((enumType) => enumType.schemaName),
  ])];

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const liveColumnsResult = await pool.query<LiveColumnRow>(
      `
        select table_schema, table_name, column_name, is_nullable
        from information_schema.columns
        where table_schema = any($1::text[])
        order by table_schema, table_name, ordinal_position
      `,
      [schemaNames]
    );

    const liveEnumsResult = await pool.query<LiveEnumRow>(
      `
        select n.nspname as schema_name, t.typname as enum_name, e.enumlabel as enum_label
        from pg_type t
        join pg_enum e on e.enumtypid = t.oid
        join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = any($1::text[])
        order by n.nspname, t.typname, e.enumsortorder
      `,
      [schemaNames]
    );

    const liveChecksResult = await pool.query<LiveCheckRow>(
      `
        select tc.table_schema, tc.table_name, tc.constraint_name
        from information_schema.table_constraints tc
        where tc.constraint_type = 'CHECK'
          and tc.table_schema = any($1::text[])
        order by tc.table_schema, tc.table_name, tc.constraint_name
      `,
      [schemaNames]
    );

    const liveTables = new Map<string, Map<string, { isNullable: boolean }>>();

    for (const row of liveColumnsResult.rows) {
      const tableKey = `${row.table_schema}.${row.table_name}`;
      const columns = liveTables.get(tableKey) ?? new Map<string, { isNullable: boolean }>();
      columns.set(row.column_name, { isNullable: row.is_nullable === 'YES' });
      liveTables.set(tableKey, columns);
    }

    const liveEnums = new Map<string, string[]>();

    for (const row of liveEnumsResult.rows) {
      const enumKey = `${row.schema_name}.${row.enum_name}`;
      const values = liveEnums.get(enumKey) ?? [];
      values.push(row.enum_label);
      liveEnums.set(enumKey, values);
    }

    const liveChecks = new Map<string, Set<string>>();

    for (const row of liveChecksResult.rows) {
      if (isGeneratedNotNullCheck(row.constraint_name)) {
        continue;
      }

      const tableKey = `${row.table_schema}.${row.table_name}`;
      const checks = liveChecks.get(tableKey) ?? new Set<string>();
      checks.add(row.constraint_name);
      liveChecks.set(tableKey, checks);
    }

    const errors: string[] = [];

    for (const [tableKey, expectedTable] of expectedTables) {
      const liveColumns = liveTables.get(tableKey);

      if (!liveColumns) {
        errors.push(`Missing table ${tableKey}`);
        continue;
      }

      for (const [columnName, expectedColumn] of expectedTable.columns) {
        const liveColumn = liveColumns.get(columnName);

        if (!liveColumn) {
          errors.push(`Missing column ${tableKey}.${columnName}`);
          continue;
        }

        if (liveColumn.isNullable !== expectedColumn.isNullable) {
          errors.push(
            `Nullability mismatch for ${tableKey}.${columnName}: expected ${
              expectedColumn.isNullable ? 'nullable' : 'not null'
            }, got ${liveColumn.isNullable ? 'nullable' : 'not null'}`
          );
        }
      }

      for (const columnName of liveColumns.keys()) {
        if (!expectedTable.columns.has(columnName)) {
          errors.push(`Unexpected column ${tableKey}.${columnName} exists in database`);
        }
      }
    }

    for (const [enumKey, expectedEnum] of expectedEnums) {
      const liveValues = liveEnums.get(enumKey);

      if (!liveValues) {
        errors.push(`Missing enum ${enumKey}`);
        continue;
      }

      if (JSON.stringify(liveValues) !== JSON.stringify(expectedEnum.values)) {
        errors.push(
          `Enum mismatch for ${enumKey}: expected [${expectedEnum.values.join(', ')}], got [${liveValues.join(', ')}]`
        );
      }
    }

    for (const [tableKey, expectedTableChecks] of expectedChecks) {
      const liveTableChecks = liveChecks.get(tableKey) ?? new Set<string>();

      for (const checkName of expectedTableChecks.keys()) {
        if (!liveTableChecks.has(checkName)) {
          errors.push(`Missing check constraint ${tableKey}.${checkName}`);
        }
      }

      for (const checkName of liveTableChecks) {
        if (!expectedTableChecks.has(checkName)) {
          errors.push(`Unexpected check constraint ${tableKey}.${checkName} exists in database`);
        }
      }
    }

    if (errors.length > 0) {
      console.error('Schema verification failed:');
      for (const error of errors) {
        console.error(`- ${error}`);
      }
      process.exit(1);
    }

    console.log(
      `Schema verification passed for ${expectedTables.size} tables, ${expectedEnums.size} enums, and ${[...expectedChecks.values()].reduce((total, tableChecks) => total + tableChecks.size, 0)} check constraints`
    );
  } finally {
    await pool.end();
  }
}

verifySchema().catch((error) => {
  console.error('Failed to verify schema:', error);
  process.exit(1);
});
