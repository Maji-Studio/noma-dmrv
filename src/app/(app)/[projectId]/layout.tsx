import { Sidebar } from "@/components/navigation";
import { requireProjectMember } from "@/data-access/projects";
import { requireAuth } from "@/lib/auth/server";

interface ProjectLayoutProps {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}

export default async function ProjectLayout({
  children,
  params,
}: ProjectLayoutProps) {
  const { projectId } = await params;
  const user = await requireAuth();
  await requireProjectMember(projectId, user.id);

  return (
    <div className="flex min-h-screen">
      <Sidebar projectId={projectId} />
      <main className="flex-1 p-xl">{children}</main>
    </div>
  );
}
