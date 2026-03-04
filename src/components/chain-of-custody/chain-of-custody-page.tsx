/**
 * Chain of Custody Page — Interactive DAG visualizer
 * Shows entity counts and status distribution for a selected facility.
 */
"use client";

import { useState, useCallback } from "react";
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
import "@xyflow/react/dist/style.css";
import { TreeStructure } from "@phosphor-icons/react/dist/ssr";
import { useFacilities } from "@/hooks/use-facilities";
import { useChainOfCustody } from "@/hooks/use-chain-of-custody";
import { ChainNode } from "./chain-node";
import { useChainGraph } from "./use-chain-graph";

// Register custom node types (stable reference outside component)
const nodeTypes: NodeTypes = {
  chainNode: ChainNode,
};

export function ChainOfCustodyPage() {
  const router = useRouter();
  const { data: facilitiesData, isLoading: facilitiesLoading, isError: facilitiesError } = useFacilities();
  const facilityList = facilitiesData?.items ?? [];

  const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(null);

  // Auto-select first facility when data loads
  const activeFacilityId = selectedFacilityId ?? facilityList[0]?.id ?? null;

  const { data: chainData, isLoading: chainLoading, isError: chainError } = useChainOfCustody(activeFacilityId);
  const { nodes, edges } = useChainGraph(chainData);

  const handleFacilityChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedFacilityId(e.target.value || null);
  }, []);

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

          <select
            aria-label="Facility"
            value={activeFacilityId ?? ""}
            onChange={handleFacilityChange}
            disabled={facilitiesLoading || facilityList.length === 0}
            className="h-[44px] px-16 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] body-medium min-w-[220px]"
          >
            {facilityList.length === 0 && (
              <option value="">No facilities</option>
            )}
            {facilityList.map((f) => (
              <option key={f.id} value={f.id}>
                {f.code} — {f.name}
              </option>
            ))}
          </select>
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
                Select a facility to view its chain of custody.
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
              defaultEdgeOptions={{ pathOptions: { offset: 20 } }}
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
