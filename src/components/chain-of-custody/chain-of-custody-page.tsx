/**
 * Chain of Custody Page — Interactive DAG visualizer
 * Shows entity counts and status distribution for the facility selected in the sidebar.
 */
"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  type NodeTypes,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { TreeStructure } from "@phosphor-icons/react/dist/ssr";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useChainOfCustody } from "@/hooks/use-chain-of-custody";
import { ChainNode } from "./chain-node";
import { useChainGraph } from "./use-chain-graph";

// Register custom node types (stable reference outside component)
const nodeTypes: NodeTypes = {
  chainNode: ChainNode,
};

export function ChainOfCustodyPage() {
  const router = useRouter();
  const {
    facilityId,
    selectedFacility,
    isLoading: facilitiesLoading,
    isError: facilitiesError,
  } = useFacilityContext();

  const { data: chainData, isLoading: chainLoading, isError: chainError } = useChainOfCustody(facilityId);
  const { nodes, edges } = useChainGraph(chainData);

  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    const href = (node.data as { href?: string | null }).href;
    if (href) router.push(href);
  }, [router]);

  const isLoading = facilitiesLoading || chainLoading;

  return (
    <div className="min-h-screen bg-[var(--color-background-light)] text-[var(--color-text-primary)]">
      <main className="flex flex-col h-screen">
        {/* Header */}
        <header className="shrink-0 px-24 py-16 flex items-center justify-between gap-16 border-b border-[var(--color-border-secondary)]">
          <div className="flex items-center gap-10">
            <TreeStructure size={18} weight="bold" className="text-[var(--clr-purple)]" />
            <h1 className="title-heading-2">Chain of Custody</h1>
          </div>
          <div className="text-right">
            <p className="body-caption uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
              Facility
            </p>
            <p className="body-medium text-[var(--color-text-secondary)]">
              {selectedFacility
                ? `${selectedFacility.code} - ${selectedFacility.name}`
                : "Selected in sidebar"}
            </p>
          </div>
        </header>

        {/* Canvas */}
        <div className="flex-1 relative">
          {facilitiesError || chainError ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="body-medium text-[var(--color-signal-red)]">
                {facilitiesError ? "Failed to load facilities." : "Failed to load chain of custody data."}
              </p>
            </div>
          ) : isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-12">
                <TreeStructure size={32} className="text-[var(--color-text-tertiary)] animate-pulse" />
                <p className="body-medium text-[var(--color-text-secondary)]">Loading chain data...</p>
              </div>
            </div>
          ) : nodes.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="body-medium text-[var(--color-text-secondary)]">
                Select a facility in the sidebar to view its chain of custody.
              </p>
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodeClick={handleNodeClick}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              proOptions={{ hideAttribution: true }}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              minZoom={0.3}
              maxZoom={2}
              defaultEdgeOptions={{ type: 'smoothstep' }}
            >
              <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--color-border-tertiary)" />
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
          )}
        </div>
      </main>
    </div>
  );
}
