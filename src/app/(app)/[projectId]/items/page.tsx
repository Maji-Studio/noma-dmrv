import { ItemList } from "@/components/items";

interface ItemsPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ItemsPage({ params }: ItemsPageProps) {
  const { projectId } = await params;

  return <ItemList projectId={projectId} />;
}
