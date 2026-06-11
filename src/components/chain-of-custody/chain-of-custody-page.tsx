/**
 * Chain of Custody Page
 * Application-first lineage with two complementary, linked views (plan
 * decision 6): the Dagre DAG is the *logical lineage* tool, the Carbon
 * Transit map is the *geography* tool. Lineage / Map / Split segment is
 * persisted in `?view=`; selections cross-highlight between the two.
 */
"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { TreeStructure } from "@phosphor-icons/react/dist/ssr";
import { EntitySelect } from "@/components/forms/entity-select";
import { cn } from "@/lib/utils";
import { useChainOfCustody } from "@/hooks/use-chain-of-custody";
import { ChainNode } from "./chain-node";
import { CarbonTransitPanel } from "./map";
import { useChainGraph } from "./use-chain-graph";

const nodeTypes: NodeTypes = {
  chainNode: ChainNode,
};

type ViewMode = "lineage" | "map" | "split";

const VIEW_MODES: Array<{ value: ViewMode; label: string }> = [
  { value: "lineage", label: "Lineage" },
  { value: "map", label: "Map" },
  { value: "split", label: "Split" },
];

const DEFAULT_VIEW: ViewMode = "lineage";

function parseViewMode(raw: string | null): ViewMode {
  return VIEW_MODES.some((mode) => mode.value === raw)
    ? (raw as ViewMode)
    : DEFAULT_VIEW;
}

function FitViewOnNodesReady({ nodeCount }: { nodeCount: number }) {
  const nodesInitialized = useNodesInitialized();
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (!nodesInitialized || nodeCount === 0) return;

    const frame = window.requestAnimationFrame(() => {
      void fitView({ padding: 0.18 });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [fitView, nodeCount, nodesInitialized]);

  return null;
}

export function ChainOfCustodyPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedApplicationId = searchParams.get("application");
  const view = parseViewMode(searchParams.get("view"));

  // Cross-link selection (DAG card ⇄ map marker / rails). The nonce lets a
  // repeat click on the same node re-trigger the map's ease-to.
  const [selection, setSelection] = useState<{ nodeId: string; nonce: number } | null>(
    null
  );
  const selectNode = (nodeId: string) =>
    setSelection((current) => ({ nodeId, nonce: (current?.nonce ?? 0) + 1 }));

  const {
    data: chainData,
    isLoading,
    isError,
    error,
  } = useChainOfCustody(selectedApplicationId);
  const { nodes, edges } = useChainGraph(chainData, {
    // In split view, card clicks locate the record on the map instead of
    // navigating (concept cross-linking); links stay live in lineage view.
    disableLinks: view === "split",
    highlightedNodeId: selection?.nodeId ?? null,
  });

  const updateParams = (mutate: (params: URLSearchParams) => void) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    mutate(nextParams);
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const handleApplicationChange = (applicationId: string | undefined) => {
    setSelection(null);
    updateParams((params) => {
      if (applicationId) {
        params.set("application", applicationId);
      } else {
        params.delete("application");
      }
    });
  };

  const handleViewChange = (nextView: ViewMode) => {
    updateParams((params) => {
      if (nextView === DEFAULT_VIEW) {
        params.delete("view");
      } else {
        params.set("view", nextView);
      }
    });
  };

  const handleNodeClick = (_event: React.MouseEvent, node: Node) => {
    if (view === "split") {
      selectNode(node.id);
      return;
    }
    const href = (node.data as { href?: string | null }).href;
    if (href) {
      router.push(href);
    }
  };

  const lineageGraph = (
    <>
      {chainData?.warnings && chainData.warnings.length > 0 ? (
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
        key={view}
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
        <FitViewOnNodesReady nodeCount={nodes.length} />
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
  );

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

          <div className="flex flex-wrap items-end justify-between gap-16">
            <div className="w-full max-w-[420px]">
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

            <div
              className="flex border-[1.5px] border-[var(--clr-dark-purple-20)]"
              role="group"
              aria-label="View mode"
              data-testid="chain-view-segment"
            >
              {VIEW_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  aria-pressed={view === mode.value}
                  onClick={() => handleViewChange(mode.value)}
                  className={cn(
                    "cursor-pointer border-r-[1.5px] border-[var(--clr-dark-purple-20)] px-14 py-10 font-mono text-[11px] font-medium uppercase tracking-[0.06em] last:border-r-0",
                    view === mode.value
                      ? "bg-[var(--clr-dark-purple)] text-[var(--color-background-white)]"
                      : "text-[var(--clr-dark-purple-60)] hover:text-[var(--clr-dark-purple)]"
                  )}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="flex-1 min-h-0 relative">
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
          ) : view === "lineage" ? (
            lineageGraph
          ) : view === "map" ? (
            <CarbonTransitPanel
              applicationId={selectedApplicationId}
              chainData={chainData}
              view="map"
              highlight={selection}
              onNodeSelect={selectNode}
            />
          ) : (
            <div className="grid h-full grid-cols-1 gap-16 p-16 xl:grid-cols-[1.45fr_1fr]">
              <div className="relative min-h-0 overflow-hidden border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
                {lineageGraph}
              </div>
              <div className="min-h-0">
                <CarbonTransitPanel
                  applicationId={selectedApplicationId}
                  chainData={chainData}
                  view="split"
                  highlight={selection}
                  onNodeSelect={selectNode}
                />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
