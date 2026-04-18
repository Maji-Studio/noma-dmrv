/**
 * Chain of Custody Page
 * Application-first lineage graph that rolls back to the linked feedstocks.
 */
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { TreeStructure } from "@phosphor-icons/react/dist/ssr";
import { EntitySelect } from "@/components/forms/entity-select";
import { useChainOfCustody } from "@/hooks/use-chain-of-custody";
import { ChainNode } from "./chain-node";
import { useChainGraph } from "./use-chain-graph";

const nodeTypes: NodeTypes = {
  chainNode: ChainNode,
};

export function ChainOfCustodyPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedApplicationId = searchParams.get("application");

  const {
    data: chainData,
    isLoading,
    isError,
    error,
  } = useChainOfCustody(selectedApplicationId);
  const { nodes, edges } = useChainGraph(chainData);

  const handleApplicationChange = (applicationId: string | undefined) => {
    const nextParams = new URLSearchParams(searchParams.toString());

    if (applicationId) {
      nextParams.set("application", applicationId);
    } else {
      nextParams.delete("application");
    }

    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const handleNodeClick = (_event: React.MouseEvent, node: Node) => {
    const href = (node.data as { href?: string | null }).href;
    if (href) {
      router.push(href);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-background-light)] text-[var(--color-text-primary)]">
      <main className="flex flex-col h-screen">
        <header className="shrink-0 px-24 py-16 flex flex-col gap-16 border-b border-[var(--color-border-secondary)]">
          <div className="flex items-start justify-between gap-16">
            <div className="flex items-center gap-10">
              <TreeStructure
                size={18}
                weight="bold"
                className="text-[var(--clr-purple)]"
              />
              <div>
                <h1 className="title-heading-2">Chain of Custody</h1>
                <p className="body-small text-[var(--color-text-secondary)] mt-2">
                  Select an application to trace its rollback back to feedstock.
                </p>
              </div>
            </div>

            <div className="text-right max-w-[320px]">
              <p className="body-caption uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
                Facility
              </p>
              <p className="body-medium text-[var(--color-text-secondary)]">
                {chainData
                  ? `${chainData.facility.code} - ${chainData.facility.name}`
                  : "Resolved from selected application"}
              </p>
            </div>
          </div>

          <div className="max-w-[420px]">
            <p className="body-caption uppercase tracking-[0.12em] text-[var(--color-text-tertiary)] mb-8">
              Application
            </p>
            <EntitySelect
              entityType="application"
              value={selectedApplicationId ?? undefined}
              onChange={handleApplicationChange}
              placeholder="Search application code"
              alwaysShowSearch
              className="bg-[var(--color-background-white)]"
            />
          </div>
        </header>

        <div className="flex-1 relative">
          {!selectedApplicationId ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="body-medium text-[var(--color-text-secondary)]">
                Select an application above to view its rollback to feedstock.
              </p>
            </div>
          ) : isError ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="body-medium text-[var(--color-signal-red)]">
                {error?.message || "Failed to load chain of custody data."}
              </p>
            </div>
          ) : isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-12">
                <TreeStructure
                  size={32}
                  className="text-[var(--color-text-tertiary)] animate-pulse"
                />
                <p className="body-medium text-[var(--color-text-secondary)]">
                  Loading lineage...
                </p>
              </div>
            </div>
          ) : (
            <>
              {chainData?.warnings.length > 0 ? (
                <div className="absolute top-16 left-16 z-10 max-w-[480px] border border-[var(--color-signal-orange)] bg-[var(--color-background-white)] p-12 shadow-sm">
                  <p className="body-caption uppercase tracking-[0.12em] text-[var(--color-signal-orange)]">
                    Missing Links
                  </p>
                  <ul className="mt-8 flex flex-col gap-6">
                    {chainData.warnings.map((warning) => (
                      <li
                        key={warning}
                        className="body-caption text-[var(--color-text-secondary)]"
                      >
                        {warning}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodeClick={handleNodeClick}
                fitView
                fitViewOptions={{ padding: 0.18 }}
                proOptions={{ hideAttribution: true }}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                minZoom={0.3}
                maxZoom={2}
                defaultEdgeOptions={{ type: "smoothstep" }}
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={16}
                  size={1}
                  color="var(--color-border-tertiary)"
                />
                <Controls
                  showInteractive={false}
                  className="!rounded-none !border-[var(--color-border-secondary)] !shadow-none [&>button]:!rounded-none"
                />
                <MiniMap
                  className="!rounded-none !border-[var(--color-border-secondary)] !shadow-none"
                  maskColor="rgba(0,0,0,0.08)"
                  nodeColor="var(--color-background-medium)"
                />
              </ReactFlow>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
