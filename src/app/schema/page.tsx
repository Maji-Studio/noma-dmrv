import { Suspense } from "react";
import { SchemaTableView } from "@/components/schema/schema-table-view";
import { getSchemaCatalog, getSchemaRelationships } from "@/lib/schema/catalog";

export default function SchemaPage() {
  const tables = getSchemaCatalog();
  const relationships = getSchemaRelationships();

  return (
    <Suspense>
      <SchemaTableView tables={tables} relationships={relationships} />
    </Suspense>
  );
}
