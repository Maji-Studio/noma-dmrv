import {
  PageHeaderSkeleton,
  TableSkeleton,
} from "@/components/ui/loading-skeleton";

const TABLE_SKELETON_COLUMNS = 5;
const TABLE_SKELETON_ROWS = 5;

export default function AppLoading() {
  return (
    <div
      className="container-max page-shell"
      role="status"
      aria-label="Loading page"
    >
      <div aria-hidden="true">
        <PageHeaderSkeleton />
      </div>
      <div aria-hidden="true">
        <TableSkeleton
          columns={TABLE_SKELETON_COLUMNS}
          rows={TABLE_SKELETON_ROWS}
        />
      </div>
    </div>
  );
}
