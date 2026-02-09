/**
 * Project settings page
 * Manage project configuration and permissions
 */
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return (
    <div>
      <h1>Settings</h1>
      <p>Project ID: {projectId}</p>
      {/* TODO: Implement project settings */}
    </div>
  );
}
