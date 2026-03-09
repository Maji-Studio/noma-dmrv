import * as schema from "@/db/schema";
import { getTableColumns, getTableName, isTable } from "drizzle-orm";
import { getTableConfig, type AnyPgTable } from "drizzle-orm/pg-core";

export type SchemaArea =
  | "Auth"
  | "Facilities"
  | "Parties"
  | "Feedstock"
  | "Production"
  | "Products"
  | "Logistics"
  | "Application"
  | "Credits"
  | "Emissions"
  | "Documentation"
  | "Certification"
  | "Compliance"
  | "Legacy/Core Template"
  | "Other";

export interface SchemaColumnInfo {
  key: string;
  name: string;
  dataType: string;
  columnType: string;
  notNull: boolean;
  hasDefault: boolean;
  isPrimary: boolean;
}

export interface SchemaRelationship {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  onDelete: string;
  onUpdate: string;
}

export interface SchemaTableInfo {
  name: string;
  area: SchemaArea;
  modulePath: string;
  summary: string;
  useCases: string[];
  isLegacy: boolean;
  columns: SchemaColumnInfo[];
  outboundRelationships: SchemaRelationship[];
  inboundRelationships: SchemaRelationship[];
}

interface TableMeta {
  area: SchemaArea;
  modulePath: string;
  summary: string;
  useCases: string[];
  isLegacy?: boolean;
}

interface RuntimeColumn {
  name: string;
  dataType: unknown;
  columnType: unknown;
  notNull: unknown;
  hasDefault: unknown;
  primary: unknown;
}

const TABLE_META: Record<string, TableMeta> = {
  users: {
    area: "Auth",
    modulePath: "src/db/schema/auth.ts",
    summary: "Stores user identity, role, and profile metadata.",
    useCases: ["Sign-up and login", "Role-based access control"],
  },
  session: {
    area: "Auth",
    modulePath: "src/db/schema/auth.ts",
    summary: "Tracks active user sessions and session tokens.",
    useCases: ["Session validation", "Session revocation"],
  },
  account: {
    area: "Auth",
    modulePath: "src/db/schema/auth.ts",
    summary: "Stores provider or password auth credentials per user.",
    useCases: ["OAuth linkage", "Password auth support"],
  },
  verification: {
    area: "Auth",
    modulePath: "src/db/schema/auth.ts",
    summary: "Stores one-time verification and reset tokens.",
    useCases: ["Email verification", "Password reset"],
  },
  facilities: {
    area: "Facilities",
    modulePath: "src/db/schema/facilities.ts",
    summary: "Master record for production sites and defaults.",
    useCases: ["Facility onboarding", "Country/regional reporting"],
  },
  reactors: {
    area: "Facilities",
    modulePath: "src/db/schema/facilities.ts",
    summary: "Defines pyrolysis equipment at each facility.",
    useCases: ["Run traceability", "Reactor-level compliance checks"],
  },
  storage_locations: {
    area: "Facilities",
    modulePath: "src/db/schema/facilities.ts",
    summary: "Defines bins/piles/areas used for material storage.",
    useCases: ["Inventory location tracking", "Mass flow traceability"],
  },
  suppliers: {
    area: "Parties",
    modulePath: "src/db/schema/parties.ts",
    summary: "Master records for feedstock suppliers.",
    useCases: ["Supply chain provenance", "Supplier contact management"],
  },
  customers: {
    area: "Parties",
    modulePath: "src/db/schema/parties.ts",
    summary: "Master records for biochar buyers and recipients.",
    useCases: ["Sales tracking", "Destination reporting"],
  },
  customer_locations: {
    area: "Parties",
    modulePath: "src/db/schema/parties.ts",
    summary: "Normalized customer destination locations.",
    useCases: ["Multi-location customer support", "GPS-linked delivery targets"],
  },
  drivers: {
    area: "Parties",
    modulePath: "src/db/schema/parties.ts",
    summary: "Transport driver records.",
    useCases: ["Delivery assignment", "Audit trail of transport operators"],
  },
  operators: {
    area: "Parties",
    modulePath: "src/db/schema/parties.ts",
    summary: "Production/reactor operator records.",
    useCases: ["Operational accountability", "Run and sample attribution"],
  },
  feedstock_deliveries: {
    area: "Feedstock",
    modulePath: "src/db/schema/feedstock.ts",
    summary: "Incoming biomass shipment records.",
    useCases: ["Receiving workflows", "Transport emissions inputs"],
  },
  feedstock_types: {
    area: "Feedstock",
    modulePath: "src/db/schema/feedstock.ts",
    summary: "Controlled feedstock taxonomy.",
    useCases: ["Consistent material classification", "Category-level analysis"],
  },
  feedstocks: {
    area: "Feedstock",
    modulePath: "src/db/schema/feedstock.ts",
    summary: "Canonical feedstock batch records for accounting.",
    useCases: ["Carbon calculations", "Sustainability evidence linkage"],
  },
  production_runs: {
    area: "Production",
    modulePath: "src/db/schema/production.ts",
    summary: "Core pyrolysis run records and calculated outputs.",
    useCases: ["Operational monitoring", "Run-level energy/emissions accounting"],
  },
  production_run_readings: {
    area: "Production",
    modulePath: "src/db/schema/production.ts",
    summary: "Time-series telemetry for each production run.",
    useCases: ["Compliance monitoring evidence", "Diagnostics and analysis"],
  },
  samples: {
    area: "Production",
    modulePath: "src/db/schema/production.ts",
    summary: "Biochar sample measurements and lab metadata.",
    useCases: ["Quality and eligibility checks", "Durability equation inputs"],
  },
  incident_reports: {
    area: "Production",
    modulePath: "src/db/schema/production.ts",
    summary: "Production incidents and corrective actions.",
    useCases: ["Adaptive management logs", "Audit-ready incident tracking"],
  },
  production_run_feedstocks: {
    area: "Production",
    modulePath: "src/db/schema/production.ts",
    summary: "Join table linking runs to consumed feedstocks.",
    useCases: ["Mass-balance tracing", "Input provenance by run"],
  },
  production_samples: {
    area: "Production",
    modulePath: "src/db/schema/production.ts",
    summary: "In-process field measurements taken during production runs.",
    useCases: ["Run-level quality checks", "Moisture and temperature evidence"],
  },
  formulations: {
    area: "Products",
    modulePath: "src/db/schema/products.ts",
    summary: "Recipe templates for finished products.",
    useCases: ["Blend standardization", "Formulation governance"],
  },
  formulation_ingredients: {
    area: "Products",
    modulePath: "src/db/schema/products.ts",
    summary: "Individual ingredient entries within a formulation recipe.",
    useCases: ["Blend composition tracking", "Ingredient ratio validation"],
  },
  biochar_products: {
    area: "Products",
    modulePath: "src/db/schema/products.ts",
    summary: "Finished product batch records and composition.",
    useCases: ["Inventory management", "Run-to-order traceability"],
  },
  vehicles: {
    area: "Logistics",
    modulePath: "src/db/schema/logistics.ts",
    summary: "Vehicle registry with fuel characteristics.",
    useCases: ["Transport planning", "Emissions factor application"],
  },
  orders: {
    area: "Logistics",
    modulePath: "src/db/schema/logistics.ts",
    summary: "Customer order records for biochar products.",
    useCases: ["Order lifecycle tracking", "Delivery planning"],
  },
  deliveries: {
    area: "Logistics",
    modulePath: "src/db/schema/logistics.ts",
    summary: "Product delivery event records.",
    useCases: ["Shipment fulfillment", "Delivered mass documentation"],
  },
  transport_legs: {
    area: "Logistics",
    modulePath: "src/db/schema/logistics.ts",
    summary: "Canonical transport emissions accounting leg records.",
    useCases: ["Distance or energy-based emissions", "Route-level audit trail"],
  },
  applications: {
    area: "Application",
    modulePath: "src/db/schema/application.ts",
    summary: "Field application events for delivered biochar.",
    useCases: ["Soil application logs", "Per-application storage accounting"],
  },
  soil_temperature_measurements: {
    area: "Application",
    modulePath: "src/db/schema/application.ts",
    summary: "Soil temperature observations linked to applications.",
    useCases: ["200-year durability baselines", "Measurement evidence"],
  },
  credit_batches: {
    area: "Credits",
    modulePath: "src/db/schema/credits.ts",
    summary: "Credit issuance/reporting aggregation batches.",
    useCases: ["Net-removal aggregation", "Registry submission preparation"],
  },
  credit_batch_applications: {
    area: "Credits",
    modulePath: "src/db/schema/credits.ts",
    summary: "Join table linking applications to credit batches.",
    useCases: ["Issuance traceability", "Inclusion/exclusion reviews"],
  },
  credit_batch_production_runs: {
    area: "Credits",
    modulePath: "src/db/schema/credits.ts",
    summary: "Join table linking production runs to credit batches.",
    useCases: ["Run-level credit attribution", "Batch composition traceability"],
  },
  emission_factors: {
    area: "Emissions",
    modulePath: "src/db/schema/emissions.ts",
    summary: "Versioned emission factors by region/fuel/unit.",
    useCases: ["Standardized CO2e calculations", "Methodology updates by date"],
  },
  documents: {
    area: "Documentation",
    modulePath: "src/db/schema/documentation.ts",
    summary: "Central optional evidence document store with polymorphic ownership.",
    useCases: ["Compliance evidence management", "Cross-entity file attachments"],
  },
  certifier_projects: {
    area: "Certification",
    modulePath: "src/db/schema/certification.ts",
    summary: "Local facility to certifier project mapping.",
    useCases: ["External project registration", "Provider linkage"],
  },
  certifier_sources: {
    area: "Certification",
    modulePath: "src/db/schema/certification.ts",
    summary: "Provider source references used by submissions.",
    useCases: ["Stable external IDs", "Submission source normalization"],
  },
  certification_submissions: {
    area: "Certification",
    modulePath: "src/db/schema/certification.ts",
    summary: "Versioned submission snapshots and lifecycle status.",
    useCases: ["Submission history", "Draft/locked/submitted lineage"],
  },
  certifier_document_uploads: {
    area: "Certification",
    modulePath: "src/db/schema/certification.ts",
    summary: "Mapping between local documents and provider document IDs.",
    useCases: ["Upload deduplication", "Provider sync traceability"],
  },
  certifier_sync_events: {
    area: "Certification",
    modulePath: "src/db/schema/certification.ts",
    summary: "Operational log for certifier sync attempts.",
    useCases: ["Integration debugging", "Retry/error monitoring"],
  },
  feedstock_sc_assessments: {
    area: "Compliance",
    modulePath: "src/db/schema/compliance.ts",
    summary: "Structured feedstock sustainability assessments.",
    useCases: ["SC criterion pass/fail records", "Assessment validity windows"],
  },
  custody_handoffs: {
    area: "Compliance",
    modulePath: "src/db/schema/compliance.ts",
    summary: "Chain-of-custody ledger of transfer events.",
    useCases: ["Material provenance records", "Transfer evidence workflow"],
  },
  ghg_materiality_assessments: {
    area: "Compliance",
    modulePath: "src/db/schema/compliance.ts",
    summary: "Materiality assessments tied to credit batches.",
    useCases: ["<1% materiality checks", "Reassessment scheduling"],
  },
  projects: {
    area: "Legacy/Core Template",
    modulePath: "src/db/schema/projects.ts",
    summary: "Legacy template project container.",
    useCases: ["Template project scoping", "Example multi-project setup"],
    isLegacy: true,
  },
  project_members: {
    area: "Legacy/Core Template",
    modulePath: "src/db/schema/projects.ts",
    summary: "Legacy table mapping users to project roles.",
    useCases: ["Template team access control", "Project membership records"],
    isLegacy: true,
  },
  items: {
    area: "Legacy/Core Template",
    modulePath: "src/db/schema/items.ts",
    summary: "Legacy example CRUD entity.",
    useCases: ["Template CRUD pattern example", "Project-scoped demo data"],
    isLegacy: true,
  },
};

function isPgTable(value: unknown): value is AnyPgTable {
  return isTable(value);
}

function createTableRelationshipList(): {
  relationships: SchemaRelationship[];
  tableColumns: Map<string, SchemaColumnInfo[]>;
} {
  const tableValues = Object.values(schema).filter(isPgTable);

  const relationships: SchemaRelationship[] = [];
  const tableColumns = new Map<string, SchemaColumnInfo[]>();

  for (const table of tableValues) {
    const tableName = getTableName(table as never);
    const columnMap = getTableColumns(table as never) as Record<string, RuntimeColumn>;

    const columns: SchemaColumnInfo[] = Object.entries(columnMap).map(
      ([key, column]) => ({
        key,
        name: column.name,
        dataType: String(column.dataType),
        columnType: String(column.columnType),
        notNull: Boolean(column.notNull),
        hasDefault: Boolean(column.hasDefault),
        isPrimary: Boolean(column.primary),
      })
    );

    tableColumns.set(
      tableName,
      columns.sort((a, b) => {
        if (a.isPrimary && !b.isPrimary) return -1;
        if (!a.isPrimary && b.isPrimary) return 1;
        return a.name.localeCompare(b.name);
      })
    );

    const config = getTableConfig(table as never);
    for (const fk of config.foreignKeys) {
      const reference = fk.reference();
      const fromTableName = getTableName(fk.table);
      const toTableName = getTableName(reference.foreignTable);

      for (let index = 0; index < reference.columns.length; index += 1) {
        const fromColumn = reference.columns[index];
        const toColumn = reference.foreignColumns[index];

        relationships.push({
          fromTable: fromTableName,
          fromColumn: fromColumn.name,
          toTable: toTableName,
          toColumn: toColumn.name,
          onDelete: String(fk.onDelete),
          onUpdate: String(fk.onUpdate),
        });
      }
    }
  }

  relationships.sort((a, b) => {
    const from = `${a.fromTable}.${a.fromColumn}`.localeCompare(
      `${b.fromTable}.${b.fromColumn}`
    );
    if (from !== 0) return from;
    return `${a.toTable}.${a.toColumn}`.localeCompare(`${b.toTable}.${b.toColumn}`);
  });

  return { relationships, tableColumns };
}

const BASE_DATA = createTableRelationshipList();

function buildCatalog(): SchemaTableInfo[] {
  const tableNames = Array.from(BASE_DATA.tableColumns.keys()).sort((a, b) =>
    a.localeCompare(b)
  );

  return tableNames.map((tableName) => {
    const meta = TABLE_META[tableName];
    const outboundRelationships = BASE_DATA.relationships.filter(
      (relationship) => relationship.fromTable === tableName
    );
    const inboundRelationships = BASE_DATA.relationships.filter(
      (relationship) => relationship.toTable === tableName
    );

    return {
      name: tableName,
      area: meta?.area ?? "Other",
      modulePath: meta?.modulePath ?? "src/db/schema/index.ts",
      summary: meta?.summary ?? "No summary provided.",
      useCases: meta?.useCases ?? [],
      isLegacy: meta?.isLegacy ?? false,
      columns: BASE_DATA.tableColumns.get(tableName) ?? [],
      outboundRelationships,
      inboundRelationships,
    };
  });
}

const CATALOG = buildCatalog().sort((a, b) => {
  const areaOrder = a.area.localeCompare(b.area);
  if (areaOrder !== 0) return areaOrder;
  return a.name.localeCompare(b.name);
});

export function getSchemaCatalog(): SchemaTableInfo[] {
  return CATALOG;
}

export function getSchemaTableByName(name: string): SchemaTableInfo | undefined {
  return CATALOG.find((table) => table.name === name);
}

export function getSchemaRelationships(): SchemaRelationship[] {
  return BASE_DATA.relationships;
}
