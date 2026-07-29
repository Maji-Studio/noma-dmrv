/**
 * Traceability Page — credit-batch anchored (ADR 0011, Phase 3).
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
import { ArrowLeftIcon, TreeStructureIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui";
import { cn } from "@/lib/utils";
import { buildBatchSankey } from "@/lib/chain-of-custody/sankey";
import {
  useChainOfCustody,
  useCreditBatchChain,
} from "@/hooks/use-chain-of-custody";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { SelectFacilityEmptyState } from "@/components/navigation";
import {
  GRAPH_CANVAS_CLASS,
  GRAPH_CONTROLS_CLASS,
  GRAPH_DOTS,
  GRAPH_MINIMAP_CLASS,
  GRAPH_MINIMAP_MASK,
} from "./chain-constants";
import { ChainEdge } from "./chain-edge";
import { ChainNode, type ChainNodeData } from "./chain-node";
import { ChainNodeSheet, type ChainNodeSheetNode } from "./chain-node-sheet";
import { CreditBatchCardSelector } from "./credit-batch-card-selector";
import { CarbonTransitPanel } from "./map";
import { RunFilterSelect, type RunFilterOption } from "./run-filter-select";
import { BatchSankey } from "./sankey";
import { ApplicationTrail } from "./trail";
import { useCreditBatchCardSelection } from "./use-credit-batch-card-selection";
import {
  reachableNodeIds,
  useBatchChainGraph,
  useChainGraph,
} from "./use-chain-graph";

const nodeTypes: NodeTypes = {
  chainNode: ChainNode,
};

const edgeTypes = {
  chainEdge: ChainEdge,
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

const MASS_UNIT_MODES: Array<{
  value: "kg" | "pct";
  label: string;
  title: string;
}> = [
  { value: "kg", label: "kg", title: "Show mass moving along each step" },
  { value: "pct", label: "%", title: "Show each step's share of its branch" },
];

const DEFAULT_APPLICATION_VIEW: ApplicationViewMode = "lineage";
const DEFAULT_BATCH_VIEW: BatchViewMode = "dag";

const RUN_SELECTOR_WRAPPER_CLASS = "w-[320px] max-w-full";

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
  /** Edge labels show mass (kg) or branch-share (%). */
  labelMode: "kg" | "pct";
  /**
   * Persistent cross-surface focus (the shared selection's reachable
   * sub-chain) — dims everything outside it. Hover focus takes precedence
   * while the pointer is over a card.
   */
  focusNodeIds?: Set<string> | null;
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
}

/** Shared ReactFlow chrome for the single-rollback and merged batch DAGs. */
function ChainFlowGraph({
  nodes,
  edges,
  warnings,
  labelMode,
  focusNodeIds,
  onNodeClick,
}: ChainFlowGraphProps) {
  // Hover focus — hovering a card fades back everything outside its lineage
  // and emphasizes the path edges. Falls back to the persistent selection
  // focus when the pointer isn't over a card.
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const related = reachableNodeIds(hoveredNodeId, edges) ?? focusNodeIds ?? null;
  const displayNodes = related
    ? nodes.map((node) =>
        related.has(node.id)
          ? node
          : { ...node, data: { ...node.data, dimmed: true } }
      )
    : nodes;
  // Always re-stamp the label mode onto edge data; layer hover focus on top.
  // NB: never raise an edge's zIndex above 0 — xyflow would float the line
  // above the HTML edge-label layer and bisect the chip text on hover. Hover
  // emphasis reads through stroke width + dimming the rest, not stacking.
  const displayEdges = edges.map((edge) => {
    const onPath = related
      ? related.has(edge.source) && related.has(edge.target)
      : true;
    return {
      ...edge,
      data: {
        ...edge.data,
        labelMode,
        ...(related ? { dimmed: !onPath, emphasized: onPath } : {}),
      },
    };
  });

  return (
    <div className="h-full w-full">
      {warnings.length > 0 ? (
        <div className="absolute top-16 left-16 z-10 max-w-[480px] border-[1.5px] border-dashed border-[var(--st-wait)] bg-[var(--paper)] p-12">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--st-wait)]">
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
        className={GRAPH_CANVAS_CLASS}
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={(_, node) => setHoveredNodeId(node.id)}
        onNodeMouseLeave={() => setHoveredNodeId(null)}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.3}
        maxZoom={2}
      >
        <FitViewOnNodesReady nodeCount={nodes.length} />
        <Background
          variant={BackgroundVariant.Dots}
          gap={GRAPH_DOTS.gap}
          size={GRAPH_DOTS.size}
          color={GRAPH_DOTS.color}
        />
        <Controls showInteractive={false} className={GRAPH_CONTROLS_CLASS} />
        <MiniMap
          className={GRAPH_MINIMAP_CLASS}
          maskColor={GRAPH_MINIMAP_MASK}
          nodeColor={(node) =>
            (node.data as { accent?: string }).accent ??
            "var(--color-background-medium)"
          }
        />
      </ReactFlow>
    </div>
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
        <TreeStructureIcon
          size={32}
          className="text-[var(--color-text-tertiary)] animate-pulse"
        />
        <p className="body-medium text-[var(--color-text-secondary)]">{label}</p>
      </div>
    </div>
  );
}

export function TraceabilityPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The page is facility-scoped like the rest of the (app) shell: the batch
  // selector only offers the current facility's batches, and a selection that
  // resolves to another facility (a facility switch, or a foreign deep link)
  // is dropped below so the chain never renders out-of-facility provenance.
  const { facilityId, selectedFacility } = useFacilityContext();
  const selectedApplicationId = searchParams.get("application");
  const selectedRunId = searchParams.get("run");
  const batchSelection = useCreditBatchCardSelection(facilityId);
  // Only a batch returned by the current facility's layered list query may
  // anchor or appear selected. This prevents a prior facility's URL value
  // from flashing its graph while the remembered/fallback selection resolves.
  const selectedBatchId = batchSelection.validSelectedBatchId;
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
  // Toggle: clicking the already-focused node again clears the focus (reset to
  // all-shown), matching the bar's hub-click and the map's basemap-click.
  const selectNode = (nodeId: string) =>
    setSelection((current) =>
      current?.nodeId === nodeId
        ? null
        : { nodeId, nonce: (current?.nonce ?? 0) + 1 }
    );
  const clearSelection = () => setSelection(null);

  // Edge-label unit toggle (kg ⇄ branch-share %) for the graph views.
  const [massUnit, setMassUnit] = useState<"kg" | "pct">("kg");
  // Node detail side-sheet — opened by a card click instead of navigating.
  const [sheetNode, setSheetNode] = useState<ChainNodeSheetNode | null>(null);
  const openNodeSheet = (node: Node) => {
    const data = node.data as unknown as ChainNodeData;
    setSheetNode({
      id: node.id,
      label: data.label,
      code: data.code,
      icon: data.icon,
      accentInk: data.accentInk,
      status: data.status,
      date: data.date,
      details: data.details,
      href: data.href,
      drillable: data.drillable,
    });
  };

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
  // A run-filtered sankey recomputes from the lineage subset; all figures
  // (including the ineligible-feedstock exit) derive from the lineages
  // themselves (issue #285), so no batch-level facts are needed.
  const filteredSankey =
    selectedRunId && batchLineages ? buildBatchSankey(batchLineages) : null;
  const { nodes: batchNodes, edges: batchEdges } = useBatchChainGraph(
    batchLineages,
    {
      // Application cards drill down instead of navigating, so links drop.
      disableLinks: true,
      highlightedNodeId: selection?.nodeId ?? null,
    }
  );

  // The shared focus: the selected node's reachable sub-chain, computed from
  // the active graph's edges and fed to the DAG (dim), the map, and the bar so
  // all three surfaces light the same sub-chain.
  const activeEdges = anchor === "batch" ? batchEdges : edges;
  const focusNodeIds = selection
    ? reachableNodeIds(selection.nodeId, activeEdges)
    : null;

  const updateParams = (mutate: (params: URLSearchParams) => void) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    mutate(nextParams);
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  // Drop a stale / foreign selection: once the batch or application resolves,
  // if its facility no longer matches the selected facility, clear the URL
  // anchor so the page falls back to the empty "select a batch" state rather
  // than showing another facility's chain. Covers both a sidebar facility
  // switch (the prior selection lingers in the URL) and a deep link into a
  // batch that belongs elsewhere.
  useEffect(() => {
    if (!facilityId) return;
    const loadedFacilityId =
      anchor === "application"
        ? chainData?.facility.id
        : anchor === "batch"
          ? batchData?.facility.id
          : undefined;
    if (!loadedFacilityId || loadedFacilityId === facilityId) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("application");
    params.delete("batch");
    params.delete("run");
    params.delete("view");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [
    facilityId,
    anchor,
    chainData?.facility.id,
    batchData?.facility.id,
    searchParams,
    router,
    pathname,
  ]);

  const handleBatchChange = (creditBatchId: string) => {
    setSelection(null);
    batchSelection.selectBatch(creditBatchId);
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
    // Split view keeps the map cross-link (click locates the record); every
    // other graph view opens the detail sheet.
    if (applicationView === "split") {
      selectNode(node.id);
      return;
    }
    openNodeSheet(node);
  };

  const handleBatchNodeClick = (_event: React.MouseEvent, node: Node) => {
    openNodeSheet(node);
  };

  /** Sheet "Trace rollback" — drill the batch into the application's lineage. */
  const traceFromSheet = (nodeId: string) => {
    const [kind, entityId] = nodeId.split(":");
    if (kind === "application" && entityId) {
      drillDownToApplication(entityId);
    }
  };

  const facility =
    (anchor === "application" ? chainData?.facility : batchData?.facility) ??
    selectedFacility;
  const viewModes =
    anchor === "batch" ? BATCH_VIEW_MODES : APPLICATION_VIEW_MODES;
  const activeView = anchor === "batch" ? batchView : applicationView;
  const defaultView =
    anchor === "batch" ? DEFAULT_BATCH_VIEW : DEFAULT_APPLICATION_VIEW;
  // The kg/% toggle only applies to the graph views (it labels edges).
  const showMassToggle =
    anchor === "batch"
      ? batchView === "dag"
      : anchor === "application" &&
        (applicationView === "lineage" || applicationView === "split");

  const applicationBody = (() => {
    if (!selectedApplicationId) return null;
    if (chainIsError) {
      return (
        <CenteredMessage tone="error">
          {chainError?.message || "The traceability data could not be loaded. Refresh the page and try again."}
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
          labelMode={massUnit}
          focusNodeIds={focusNodeIds}
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
          focusNodeIds={focusNodeIds}
          onNodeSelect={selectNode}
          onClearSelection={clearSelection}
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
        <div className="relative min-h-0 overflow-hidden border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)]">
          <ChainFlowGraph
            nodes={nodes}
            edges={edges}
            warnings={chainData?.warnings ?? []}
            labelMode={massUnit}
            focusNodeIds={focusNodeIds}
            onNodeClick={handleNodeClick}
          />
        </div>
        <div className="min-h-0">
          <CarbonTransitPanel
            source={{ kind: "application", id: selectedApplicationId }}
            lineages={chainData ? [chainData] : undefined}
            view="split"
            highlight={selection}
            focusNodeIds={focusNodeIds}
            onNodeSelect={selectNode}
            onClearSelection={clearSelection}
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
          {batchError?.message || "The credit batch traceability data could not be loaded. Refresh the page and try again."}
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
          labelMode={massUnit}
          focusNodeIds={focusNodeIds}
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
          focusNodeIds={focusNodeIds}
          onNodeSelect={selectNode}
          onClearSelection={clearSelection}
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

  if (!facilityId) {
    return (
      <div className="container-max page-shell">
        <PageHeader
          title="Traceability"
          subtitle="Trace a credit batch's provenance back through production to feedstock."
        />
        <SelectFacilityEmptyState description="Choose a facility from the sidebar to trace its provenance." />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--color-text-primary)]">
      <main className="flex flex-col h-screen">
        {/* Horizontal rhythm matches the app shell (container-max); only the
            canvas below is full-bleed. */}
        <header className="shrink-0 border-b border-[var(--color-border-secondary)]">
          <div className="container-max py-16 flex flex-col gap-16">
          <div className="flex items-start justify-between gap-16">
            <PageHeader
              title="Traceability"
              subtitle="Select a credit batch to roll up its provenance, narrow it by production run, or click an application card to trace a single rollback."
            />

            <div className="text-right max-w-[320px]">
              <p className="body-caption uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
                Facility
              </p>
              <p className="body-medium text-[var(--color-text-secondary)]">
                {facility
                  ? `${facility.code}: ${facility.name}`
                  : "Resolved from the selection"}
              </p>
            </div>
          </div>

          <CreditBatchCardSelector
            batches={batchSelection.batches}
            selectedBatchId={selectedBatchId}
            isLoading={batchSelection.isLoading}
            isError={batchSelection.isError}
            error={batchSelection.error}
            onSelect={handleBatchChange}
          />

          <div className="flex flex-wrap items-end justify-between gap-16">
            <div className="flex flex-wrap items-end gap-16">
              {anchor === "batch" ? (
                <div className={RUN_SELECTOR_WRAPPER_CLASS} data-testid="chain-run-select">
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
                <Button
                  variant="default"
                  onClick={backToBatch}
                  data-testid="chain-back-to-batch"
                  className="border-[1.5px] border-[var(--clr-dark-purple-20)] px-[14px] text-[11px] tracking-[0.06em] text-[var(--clr-dark-purple-60)] hover:text-[var(--clr-dark-purple)]"
                >
                  <ArrowLeftIcon size={14} weight="bold" />
                  Batch roll-up
                </Button>
              ) : null}
            </div>

            {anchor !== "none" ? (
              <div className="flex flex-wrap items-end gap-12">
                {showMassToggle ? (
                  <div
                    className="flex border-[1.5px] border-[var(--clr-dark-purple-20)]"
                    role="group"
                    aria-label="Edge label unit"
                    data-testid="chain-mass-toggle"
                  >
                    {MASS_UNIT_MODES.map((mode) => (
                      <button
                        key={mode.value}
                        type="button"
                        aria-pressed={massUnit === mode.value}
                        onClick={() => setMassUnit(mode.value)}
                        title={mode.title}
                        className={cn(
                          "cursor-pointer border-r-[1.5px] border-[var(--clr-dark-purple-20)] px-[14px] py-10 font-mono text-[11px] font-medium uppercase tracking-[0.06em] last:border-r-0",
                          massUnit === mode.value
                            ? "bg-[var(--clr-dark-purple)] text-[var(--color-background-white)]"
                            : "text-[var(--clr-dark-purple-60)] hover:text-[var(--clr-dark-purple)]"
                        )}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                ) : null}
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
              </div>
            ) : null}
          </div>
          </div>
        </header>

        <div className="flex-1 min-h-0 relative">
          {anchor === "none" ? (
            batchSelection.isLoading ? (
              <CenteredMessage>
                Loading this facility&apos;s credit batches…
              </CenteredMessage>
            ) : batchSelection.isError || batchSelection.batches.length === 0 ? null : (
              <CenteredMessage>
                Selecting the remembered or most recent credit batch…
              </CenteredMessage>
            )
          ) : anchor === "application" ? (
            applicationBody
          ) : (
            batchBody
          )}
        </div>
      </main>

      <ChainNodeSheet
        node={sheetNode}
        onOpenChange={(open) => {
          if (!open) setSheetNode(null);
        }}
        onViewRecord={
          sheetNode?.href
            ? () => {
                if (sheetNode.href) router.push(sheetNode.href);
              }
            : undefined
        }
        onTrace={
          sheetNode?.drillable ? () => traceFromSheet(sheetNode.id) : undefined
        }
      />
    </div>
  );
}
