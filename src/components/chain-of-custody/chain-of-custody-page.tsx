/**
 * Chain of Custody Page — credit-batch anchored (ADR 0011, Phase 3).
 *
 * The page re-anchors on the credit batch — the unit whose provenance
 * verification actually cares about — with the single application's rollback
 * as the drill-down. Header selectors: a credit batch resolves to the
 * roll-up readings (merged DAG | transit Map | mass-balance Sankey), and a
 * production-run filter (derived from the batch's lineages) narrows the
 * roll-up to one run's flow. The application drill-down (Lineage | Map |
 * Split | Trail) opens by clicking an application card or via the
 * `?application=` deep link; `?batch=` + `?application=` together =
 * drill-down within the batch context (a back-to-roll-up affordance keeps
 * the batch reachable). `?run=` deep-links the run filter.
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
  type Edge,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { ArrowLeft, TreeStructure } from "@phosphor-icons/react/dist/ssr";
import { EntitySelect } from "@/components/forms/entity-select";
import { cn } from "@/lib/utils";
import { buildBatchSankey } from "@/lib/chain-of-custody/sankey";
import {
  useChainOfCustody,
  useCreditBatchChain,
} from "@/hooks/use-chain-of-custody";
import { ChainNode } from "./chain-node";
import { CarbonTransitPanel } from "./map";
import { RunFilterSelect, type RunFilterOption } from "./run-filter-select";
import { BatchSankey } from "./sankey";
import { ApplicationTrail } from "./trail";
import { useBatchChainGraph, useChainGraph } from "./use-chain-graph";

const nodeTypes: NodeTypes = {
  chainNode: ChainNode,
};

type ApplicationViewMode = "lineage" | "map" | "split" | "trail";
type BatchViewMode = "dag" | "map" | "sankey";

const APPLICATION_VIEW_MODES: Array<{ value: ApplicationViewMode; label: string }> = [
  { value: "lineage", label: "Lineage" },
  { value: "map", label: "Map" },
  { value: "split", label: "Split" },
  { value: "trail", label: "Trail" },
];

const BATCH_VIEW_MODES: Array<{ value: BatchViewMode; label: string }> = [
  { value: "dag", label: "DAG" },
  { value: "map", label: "Map" },
  { value: "sankey", label: "Sankey" },
];

const DEFAULT_APPLICATION_VIEW: ApplicationViewMode = "lineage";
const DEFAULT_BATCH_VIEW: BatchViewMode = "dag";

// Shared width for the batch / run selector wrappers in the page header.
const SELECTOR_WRAPPER_CLASS = "w-[320px] max-w-full";

function parseApplicationView(raw: string | null): ApplicationViewMode {
  return APPLICATION_VIEW_MODES.some((mode) => mode.value === raw)
    ? (raw as ApplicationViewMode)
    : DEFAULT_APPLICATION_VIEW;
}

function parseBatchView(raw: string | null): BatchViewMode {
  return BATCH_VIEW_MODES.some((mode) => mode.value === raw)
    ? (raw as BatchViewMode)
    : DEFAULT_BATCH_VIEW;
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

interface ChainFlowGraphProps {
  nodes: Node[];
  edges: Edge[];
  warnings: string[];
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
}

/** Shared ReactFlow chrome for the single-rollback and merged batch DAGs. */
function ChainFlowGraph({ nodes, edges, warnings, onNodeClick }: ChainFlowGraphProps) {
  return (
    <>
      {warnings.length > 0 ? (
        <div className="absolute top-16 left-16 z-10 max-w-[480px] border border-[var(--color-signal-orange)] bg-[var(--color-background-white)] p-12 shadow-sm">
          <p className="body-caption uppercase tracking-[0.12em] text-[var(--color-signal-orange)]">
            Missing Links
          </p>
          <ul className="mt-8 flex flex-col gap-6">
            {warnings.map((warning) => (
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
        onNodeClick={onNodeClick}
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
          nodeColor={(node) =>
            (node.data as { accent?: string }).accent ??
            "var(--color-background-medium)"
          }
        />
      </ReactFlow>
    </>
  );
}

function CenteredMessage({ children, tone = "secondary" }: {
  children: React.ReactNode;
  tone?: "secondary" | "error";
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <p
        className={cn(
          "body-medium max-w-[480px] text-center",
          tone === "error"
            ? "text-[var(--color-signal-red)]"
            : "text-[var(--color-text-secondary)]"
        )}
      >
        {children}
      </p>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="flex flex-col items-center gap-12">
        <TreeStructure
          size={32}
          className="text-[var(--color-text-tertiary)] animate-pulse"
        />
        <p className="body-medium text-[var(--color-text-secondary)]">{label}</p>
      </div>
    </div>
  );
}

export function ChainOfCustodyPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedApplicationId = searchParams.get("application");
  const selectedBatchId = searchParams.get("batch");
  const selectedRunId = searchParams.get("run");
  // Application wins: with both params present the page is a drill-down
  // inside the batch context (plan decision 5).
  const anchor: "application" | "batch" | "none" = selectedApplicationId
    ? "application"
    : selectedBatchId
      ? "batch"
      : "none";
  const applicationView = parseApplicationView(searchParams.get("view"));
  const batchView = parseBatchView(searchParams.get("view"));

  // Cross-link selection (DAG card ⇄ map marker / rails). The nonce lets a
  // repeat click on the same node re-trigger the map's ease-to.
  const [selection, setSelection] = useState<{ nodeId: string; nonce: number } | null>(
    null
  );
  const selectNode = (nodeId: string) =>
    setSelection((current) => ({ nodeId, nonce: (current?.nonce ?? 0) + 1 }));

  const {
    data: chainData,
    isLoading: chainLoading,
    isError: chainIsError,
    error: chainError,
  } = useChainOfCustody(selectedApplicationId);
  const {
    data: batchData,
    isLoading: batchLoading,
    isError: batchIsError,
    error: batchError,
  } = useCreditBatchChain(selectedBatchId);

  const { nodes, edges } = useChainGraph(
    anchor === "application" ? chainData : undefined,
    {
      // In split view, card clicks locate the record on the map instead of
      // navigating (concept cross-linking); links stay live in lineage view.
      disableLinks: applicationView === "split",
      highlightedNodeId: selection?.nodeId ?? null,
    }
  );
  // The run filter narrows the roll-up to lineages flowing through one
  // production run — a derived subset of the batch, never a wider fetch.
  const filteredBatchLineages =
    anchor === "batch"
      ? batchData?.lineages.filter(
          (lineage) =>
            !selectedRunId ||
            lineage.chain.productionRun?.id === selectedRunId
        )
      : undefined;
  const batchLineages = filteredBatchLineages?.map((lineage) => lineage.chain);
  const runOptions: RunFilterOption[] = (() => {
    const byRun = new Map<string, RunFilterOption>();
    for (const lineage of batchData?.lineages ?? []) {
      const run = lineage.chain.productionRun;
      if (!run) continue;
      const existing = byRun.get(run.id);
      if (existing) {
        existing.applicationCount += 1;
      } else {
        byRun.set(run.id, {
          id: run.id,
          code: run.code,
          date: run.date,
          applicationCount: 1,
        });
      }
    }
    return Array.from(byRun.values()).sort((a, b) =>
      a.code.localeCompare(b.code)
    );
  })();
  // Run-filtered warnings re-merge from the subset (batch warnings are
  // app-prefixed batch-wide strings, so the unfiltered set would leak
  // out-of-scope applications into the narrowed view).
  const batchWarnings = selectedRunId
    ? Array.from(
        new Set(
          (filteredBatchLineages ?? []).flatMap((lineage) =>
            lineage.chain.warnings.map(
              (warning) => `${lineage.chain.application.code}: ${warning}`
            )
          )
        )
      )
    : (batchData?.warnings ?? []);
  // Batch-level facts (ineligible mass, tCO₂e) don't decompose per run, so a
  // filtered sankey recomputes from the subset without them.
  const filteredSankey =
    selectedRunId && batchLineages
      ? buildBatchSankey(batchLineages, {
          ineligibleFeedstockMassKg: null,
          totalCo2eStoredTons: null,
          totalCo2eEmissionsTons: null,
          totalCo2eCounterfactualTons: null,
        })
      : null;
  const { nodes: batchNodes, edges: batchEdges } = useBatchChainGraph(
    batchLineages,
    {
      // Application cards drill down instead of navigating, so links drop.
      disableLinks: true,
      highlightedNodeId: selection?.nodeId ?? null,
    }
  );

  const updateParams = (mutate: (params: URLSearchParams) => void) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    mutate(nextParams);
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const handleBatchChange = (creditBatchId: string | undefined) => {
    setSelection(null);
    updateParams((params) => {
      params.delete("application");
      params.delete("run");
      params.delete("view");
      if (creditBatchId) {
        params.set("batch", creditBatchId);
      } else {
        params.delete("batch");
      }
    });
  };

  const handleRunChange = (runId: string | undefined) => {
    setSelection(null);
    updateParams((params) => {
      if (runId) {
        params.set("run", runId);
      } else {
        params.delete("run");
      }
    });
  };

  /** Batch DAG drill-down: open one member application, keeping the batch. */
  const drillDownToApplication = (applicationId: string) => {
    setSelection(null);
    updateParams((params) => {
      params.set("application", applicationId);
      params.delete("view");
    });
  };

  const backToBatch = () => {
    setSelection(null);
    updateParams((params) => {
      params.delete("application");
      params.delete("view");
    });
  };

  const handleViewChange = (nextView: string, defaultView: string) => {
    updateParams((params) => {
      if (nextView === defaultView) {
        params.delete("view");
      } else {
        params.set("view", nextView);
      }
    });
  };

  const handleNodeClick = (_event: React.MouseEvent, node: Node) => {
    if (applicationView === "split") {
      selectNode(node.id);
      return;
    }
    const href = (node.data as { href?: string | null }).href;
    if (href) {
      router.push(href);
    }
  };

  const handleBatchNodeClick = (_event: React.MouseEvent, node: Node) => {
    const [kind, entityId] = node.id.split(":");
    if (kind === "application" && entityId) {
      drillDownToApplication(entityId);
      return;
    }
    selectNode(node.id);
  };

  const facility =
    anchor === "application" ? chainData?.facility : batchData?.facility;
  const viewModes =
    anchor === "batch" ? BATCH_VIEW_MODES : APPLICATION_VIEW_MODES;
  const activeView = anchor === "batch" ? batchView : applicationView;
  const defaultView =
    anchor === "batch" ? DEFAULT_BATCH_VIEW : DEFAULT_APPLICATION_VIEW;

  const applicationBody = (() => {
    if (!selectedApplicationId) return null;
    if (chainIsError) {
      return (
        <CenteredMessage tone="error">
          {chainError?.message || "Failed to load chain of custody data."}
        </CenteredMessage>
      );
    }
    if (chainLoading) {
      return <LoadingState label="Loading lineage..." />;
    }
    if (applicationView === "lineage") {
      return (
        <ChainFlowGraph
          nodes={nodes}
          edges={edges}
          warnings={chainData?.warnings ?? []}
          onNodeClick={handleNodeClick}
        />
      );
    }
    if (applicationView === "map") {
      return (
        <CarbonTransitPanel
          source={{ kind: "application", id: selectedApplicationId }}
          lineages={chainData ? [chainData] : undefined}
          view="map"
          highlight={selection}
          onNodeSelect={selectNode}
        />
      );
    }
    if (applicationView === "trail") {
      return (
        <ApplicationTrail
          applicationId={selectedApplicationId}
          chainData={chainData}
        />
      );
    }
    return (
      <div className="grid h-full grid-cols-1 gap-16 p-16 xl:grid-cols-[1.45fr_1fr]">
        <div className="relative min-h-0 overflow-hidden border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
          <ChainFlowGraph
            nodes={nodes}
            edges={edges}
            warnings={chainData?.warnings ?? []}
            onNodeClick={handleNodeClick}
          />
        </div>
        <div className="min-h-0">
          <CarbonTransitPanel
            source={{ kind: "application", id: selectedApplicationId }}
            lineages={chainData ? [chainData] : undefined}
            view="split"
            highlight={selection}
            onNodeSelect={selectNode}
          />
        </div>
      </div>
    );
  })();

  const batchBody = (() => {
    if (!selectedBatchId) return null;
    if (batchIsError) {
      return (
        <CenteredMessage tone="error">
          {batchError?.message || "Failed to load credit batch chain of custody data."}
        </CenteredMessage>
      );
    }
    if (batchLoading) {
      return <LoadingState label="Loading batch roll-up..." />;
    }
    if (!batchData) return null;
    if (batchData.lineages.length === 0 && batchView !== "sankey") {
      return (
        <CenteredMessage>
          This credit batch has no member applications yet, so there is no
          lineage to roll up.
        </CenteredMessage>
      );
    }
    if (selectedRunId && (filteredBatchLineages?.length ?? 0) === 0) {
      return (
        <CenteredMessage>
          No lineage in this batch flows through the selected production run.
        </CenteredMessage>
      );
    }
    if (batchView === "dag") {
      return (
        <ChainFlowGraph
          nodes={batchNodes}
          edges={batchEdges}
          warnings={batchWarnings}
          onNodeClick={handleBatchNodeClick}
        />
      );
    }
    if (batchView === "map") {
      return (
        <CarbonTransitPanel
          source={{ kind: "creditBatch", id: selectedBatchId }}
          lineages={batchLineages}
          view="map"
          highlight={selection}
          onNodeSelect={selectNode}
        />
      );
    }
    return (
      <BatchSankey
        sankey={filteredSankey ?? batchData.sankey}
        batchCode={batchData.batch.code}
      />
    );
  })();

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
                  Select a credit batch to roll up its provenance, narrow it by
                  production run, or click an application card to trace a
                  single rollback.
                </p>
              </div>
            </div>

            <div className="text-right max-w-[320px]">
              <p className="body-caption uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
                Facility
              </p>
              <p className="body-medium text-[var(--color-text-secondary)]">
                {facility
                  ? `${facility.code} - ${facility.name}`
                  : "Resolved from the selection"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-16">
            <div className="flex flex-wrap items-end gap-16">
              <div className={SELECTOR_WRAPPER_CLASS} data-testid="chain-batch-select">
                <p className="body-caption uppercase tracking-[0.12em] text-[var(--color-text-tertiary)] mb-8">
                  Credit Batch
                </p>
                <EntitySelect
                  entityType="creditBatch"
                  value={anchor === "batch" ? (selectedBatchId ?? undefined) : undefined}
                  onChange={handleBatchChange}
                  placeholder="Search batch code"
                  alwaysShowSearch
                  className="bg-[var(--color-background-white)]"
                />
              </div>
              {anchor === "batch" ? (
                <div className={SELECTOR_WRAPPER_CLASS} data-testid="chain-run-select">
                  <p className="body-caption uppercase tracking-[0.12em] text-[var(--color-text-tertiary)] mb-8">
                    Production Run
                  </p>
                  <RunFilterSelect
                    runs={runOptions}
                    value={selectedRunId}
                    onChange={handleRunChange}
                    disabled={batchLoading || runOptions.length === 0}
                  />
                </div>
              ) : null}
              {anchor === "application" && selectedBatchId ? (
                <button
                  type="button"
                  onClick={backToBatch}
                  data-testid="chain-back-to-batch"
                  className="flex h-40 cursor-pointer items-center gap-8 border-[1.5px] border-[var(--clr-dark-purple-20)] px-[14px] font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--clr-dark-purple-60)] hover:text-[var(--clr-dark-purple)]"
                >
                  <ArrowLeft size={14} weight="bold" />
                  Batch roll-up
                </button>
              ) : null}
            </div>

            {anchor !== "none" ? (
              <div
                className="flex border-[1.5px] border-[var(--clr-dark-purple-20)]"
                role="group"
                aria-label="View mode"
                data-testid="chain-view-segment"
              >
                {viewModes.map((mode) => (
                  <button
                    key={mode.value}
                    type="button"
                    aria-pressed={activeView === mode.value}
                    onClick={() => handleViewChange(mode.value, defaultView)}
                    className={cn(
                      "cursor-pointer border-r-[1.5px] border-[var(--clr-dark-purple-20)] px-[14px] py-10 font-mono text-[11px] font-medium uppercase tracking-[0.06em] last:border-r-0",
                      activeView === mode.value
                        ? "bg-[var(--clr-dark-purple)] text-[var(--color-background-white)]"
                        : "text-[var(--clr-dark-purple-60)] hover:text-[var(--clr-dark-purple)]"
                    )}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </header>

        <div className="flex-1 min-h-0 relative">
          {anchor === "none" ? (
            <CenteredMessage>
              Select a credit batch above to view its chain of custody.
            </CenteredMessage>
          ) : anchor === "application" ? (
            applicationBody
          ) : (
            batchBody
          )}
        </div>
      </main>
    </div>
  );
}
