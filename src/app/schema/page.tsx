import { SchemaExplorer } from "@/components/schema/schema-explorer";
import { getSchemaCatalog, getSchemaRelationships } from "@/lib/schema/catalog";

export default function SchemaPage() {
  const tables = getSchemaCatalog();
  const relationships = getSchemaRelationships();

  return <SchemaExplorer tables={tables} relationshipCount={relationships.length} />;
}

