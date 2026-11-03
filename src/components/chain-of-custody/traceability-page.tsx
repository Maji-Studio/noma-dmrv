/**
 * Traceability Page — credit-batch anchored (ADR 0011, Phase 3).
 *
 * The page re-anchors on the credit batch — the unit whose provenance
 * verification actually cares about — with the single application's rollback
 * as the drill-down. Header selectors: a credit batch resolves to the
 * roll-up readings (merged Flow | transit Map | mass-balance Sankey) plus
 * the batch's recorded Activity, and a
 * production-run filter (derived from the batch's rollbacks and roll-forwards) narrows the
 * roll-up to one run's flow. The application drill-down (Flow | Map |
 * Split | Trail) opens from an application record's sheet or via the
 * `?application=` deep link; `?batch=` + `?application=` together =
 * drill-down within the batch context (a back-to-roll-up affordance keeps
 * the batch reachable). `?run=` deep-links the run filter.
 */
"use client";

import { CreditBatchActivityView } from "@/components/activity";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { Button, EmptyState, PageHeader } from "@/components/ui";
import {
  useChainOfCustody,
  useCreditBatchChain,
} from "@/hooks/use-chain-of-custody";
import { useFacilityClock, useFacilityContext } from "@/hooks/use-facility-context";
import { buildBatchSankey } from "@/lib/chain-of-custody/sankey";
import { TRACEABILITY_ACTIVITY_VIEW } from "@/lib/certification/links";
import { cn } from "@/lib/utils";
import { CertificateIcon, TreeStructureIcon } from "@phosphor-icons/react/dist/ssr";
import type { Node } from "@xyflow/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChainFlowGraph } from "./chain-flow-graph";
import type { ChainNodeData } from "./chain-node";
import { ChainNodeSheet, type ChainNodeSheetNode } from "./chain-node-sheet";
import { ApplicationTraceMap, TraceMap } from "./map";
import { type RunPickerOption } from "./run-picker";
import { BatchSankey, SankeyEmpty } from "./sankey";
import { TraceabilityHeader } from "./traceability-header";
import { ApplicationTrail } from "./trail";
import {
  reachableNodeIds,
  useBatchChainGraph,
  useChainGraph,
} from "./use-chain-graph";
import { useCreditBatchCardSelection } from "./use-credit-batch-card-selection";
import {
  NO_LINEAGE_FOR_SELECTED_RUN,
  NO_RUN_APPLICATION_YET_WARNING,
} from "@/lib/chain-of-custody/copy";

// One chart, one name: the batch roll-up and the application drill-down both
// call it Flow. Old `?view=dag` / `?view=lineage` links fall back to it.
type ApplicationViewMode = "flow" | "map" | "split" | "trail";
type BatchViewMode = "flow" | "map" | "sankey" | typeof TRACEABILITY_ACTIVITY_VIEW;

const APPLICATION_VIEW_MODES: Array<{ value: ApplicationViewMode; label: string }> = [
  { value: "flow", label: "Flow" },
  { value: "map", label: "Map" },
  { value: "split", label: "Split" },
  { value: "trail", label: "Trail" },
];

const BATCH_VIEW_MODES: Array<{ value: BatchViewMode; label: string }> = [
  { value: "flow", label: "Flow" },
  { value: "map", label: "Map" },
  { value: "sankey", label: "Sankey" },
  { value: TRACEABILITY_ACTIVITY_VIEW, label: "Activities" },
];

const DEFAULT_APPLICATION_VIEW: ApplicationViewMode = "flow";
const DEFAULT_BATCH_VIEW: BatchViewMode = "flow";

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

/**
 * Zero / failed batch list. The command bar can only fit a truncated band, so
 * the canvas carries the explanation and the next step (design-system rule:
 * an empty state is never a bare line of text).
 */
function NoBatchesState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="container-max flex h-full items-center justify-center py-24">
      <div className="w-full max-w-[640px]">
        <EmptyState
          icon={<CertificateIcon size={48} weight="thin" />}
          title={title}
          description={description}
          action={action}
        />
      </div>
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
  const { timeZone } = useFacilityClock(facilityId);
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

  // The Flow selection: the clicked record, whose lineage stays lit.
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const clearSelection = () => setSelectedNodeId(null);

  // Edge-label unit toggle (kg ⇄ branch-share %) for the graph views.
  const [massUnit, setMassUnit] = useState<"kg" | "pct">("kg");
  // Node detail side-sheet: opened by a record click instead of navigating.
  const [sheetNode, setSheetNode] = useState<ChainNodeSheetNode | null>(null);
  const toSheetNode = (node: Node): ChainNodeSheetNode => {
    const data = node.data as unknown as ChainNodeData;
    return {
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
    };
  };
  const openNodeSheet = (node: Node) => {
    setSheetNode(toSheetNode(node));
  };

  // The selection is keyed to the plotted source, so any change of source
  // drops it, not just the command bar's own handlers. A facility switch, the
  // remembered-batch resolution and a hand-edited URL all move the source
  // without going through those. Reset during render (the React-recommended
  // reset-on-prop-change) rather than via useEffect. The maps are keyed on it
  // too, so their walk starts over.
  const detailSourceKey = `${anchor}|${selectedApplicationId ?? ""}|${selectedBatchId ?? ""}|${selectedRunId ?? ""}`;
  const [detailSource, setDetailSource] = useState(detailSourceKey);
  if (detailSource !== detailSourceKey) {
    setDetailSource(detailSourceKey);
    setSelectedNodeId(null);
  }

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
      // In split view, record clicks move the map's walk instead of
      // navigating; links stay live in Flow view.
      disableLinks: applicationView === "split",
      // Split lights the walk's step instead; a Flow-view ring would linger.
      highlightedNodeId: applicationView === "split" ? null : selectedNodeId,
      timeZone,
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
  const batchRollForwards =
    anchor === "batch"
      ? batchData?.rollForwards.filter(
          (rollForward) =>
            !selectedRunId ||
            rollForward.source.productionRun.id === selectedRunId
        )
      : undefined;
  const runOptions: RunPickerOption[] = (() => {
    const byRun = new Map<string, RunPickerOption>();
    const countedApplications = new Set<string>();
    for (const lineage of batchData?.lineages ?? []) {
      const run = lineage.chain.productionRun;
      if (!run) continue;
      const membershipKey = `${run.id}:${lineage.applicationId}`;
      if (countedApplications.has(membershipKey)) continue;
      countedApplications.add(membershipKey);
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
    // Member runs nothing has been applied from yet still trace forward.
    for (const { source } of batchData?.rollForwards ?? []) {
      const run = source.productionRun;
      if (byRun.has(run.id)) continue;
      byRun.set(run.id, {
        id: run.id,
        code: run.code,
        date: run.date,
        applicationCount: 0,
      });
    }
    return Array.from(byRun.values()).sort((a, b) =>
      a.code.localeCompare(b.code)
    );
  })();
  // Run-filtered warnings re-merge from the subset (batch warnings are
  // app-prefixed batch-wide strings, so the unfiltered set would leak
  // out-of-scope applications into the narrowed view).
  const batchWarnings = selectedRunId
    ? (filteredBatchLineages?.length ?? 0) === 0
      ? [NO_RUN_APPLICATION_YET_WARNING]
      : Array.from(
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
  // derive from the lineages
  // themselves (issue #285), so no batch-level facts are needed.
  const filteredSankey =
    selectedRunId && batchLineages ? buildBatchSankey(batchLineages) : null;
  const { nodes: batchNodes, edges: batchEdges } = useBatchChainGraph(
    batchLineages,
    batchRollForwards,
    {
      // Application records drill down instead of navigating, so links drop.
      disableLinks: true,
      highlightedNodeId: selectedNodeId,
      timeZone,
    }
  );

  // The Flow focus: the selected record's reachable sub-chain, computed from
  // the active graph's edges. (Split lights the map walk's step instead.)
  const activeEdges = anchor === "batch" ? batchEdges : edges;
  const focusNodeIds = selectedNodeId
    ? reachableNodeIds(selectedNodeId, activeEdges)
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

  // The four navigations below all move `detailSourceKey`, so the reset above
  // clears the selection for them.
  const handleBatchChange = (creditBatchId: string) => {
    batchSelection.selectBatch(creditBatchId);
  };

  const handleRunChange = (runId: string | undefined) => {
    updateParams((params) => {
      if (runId) {
        params.set("run", runId);
      } else {
        params.delete("run");
      }
    });
  };

  /** Batch Flow drill-down: open one member application, keeping the batch. */
  const drillDownToApplication = (applicationId: string) => {
    updateParams((params) => {
      params.set("application", applicationId);
      params.delete("view");
    });
  };

  const backToBatch = () => {
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

  /** Flow click: light the record's lineage and open its detail sheet. */
  const focusAndOpenNode = (node: Node) => {
    setSelectedNodeId(node.id);
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
      ? batchView === "flow"
      : anchor === "application" &&
        (applicationView === "flow" || applicationView === "split");

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
    if (applicationView === "flow") {
      return (
        <ChainFlowGraph
          key={detailSourceKey}
          nodes={nodes}
          edges={edges}
          warnings={chainData?.warnings ?? []}
          labelMode={massUnit}
          focusNodeIds={focusNodeIds}
          onNodeClick={focusAndOpenNode}
          onPaneClick={clearSelection}
        />
      );
    }
    if (applicationView === "map") {
      return (
        <ApplicationTraceMap
          key={detailSourceKey}
          applicationId={selectedApplicationId}
          chainData={chainData}
          nodes={nodes}
          edges={edges}
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
    // Split: the Flow lights the walk's current step, and a Flow pick moves
    // the walk to that record.
    return (
      <ApplicationTraceMap
        key={detailSourceKey}
        applicationId={selectedApplicationId}
        chainData={chainData}
        nodes={nodes}
        edges={edges}
        renderFlow={(stepNodeIds, pick) => (
          <ChainFlowGraph
            nodes={nodes}
            edges={edges}
            warnings={chainData?.warnings ?? []}
            labelMode={massUnit}
            focusNodeIds={stepNodeIds}
            onNodeClick={(node) => pick(node.id)}
          />
        )}
      />
    );
  })();

  const batchBody = (() => {
    if (!selectedBatchId) return null;
    // Activity reads the batch's own history, not its lineage, so it renders
    // without waiting for the roll-up and even for a batch with no runs.
    if (batchView === TRACEABILITY_ACTIVITY_VIEW) {
      return (
        <CreditBatchActivityView
          facilityId={facilityId}
          key={selectedBatchId}
          creditBatchId={selectedBatchId}
          batchCode={batchSelection.batches.find((batch) => batch.id === selectedBatchId)?.code}
        />
      );
    }
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
    if (batchData.rollForwards.length === 0) {
      return (
        <CenteredMessage>
          This credit batch has no member production runs yet, so there is
          nothing to trace.
        </CenteredMessage>
      );
    }
    if (
      selectedRunId &&
      (filteredBatchLineages?.length ?? 0) === 0 &&
      (batchRollForwards?.length ?? 0) === 0
    ) {
      return (
        <CenteredMessage>{NO_LINEAGE_FOR_SELECTED_RUN}</CenteredMessage>
      );
    }
    if (batchView === "flow") {
      return (
        <ChainFlowGraph
          key={detailSourceKey}
          nodes={batchNodes}
          edges={batchEdges}
          warnings={batchWarnings}
          labelMode={massUnit}
          focusNodeIds={focusNodeIds}
          onNodeClick={focusAndOpenNode}
          onPaneClick={clearSelection}
        />
      );
    }
    if (batchView === "map") {
      return (
        <TraceMap
          key={detailSourceKey}
          batchId={selectedBatchId}
          runId={selectedRunId}
          nodes={batchNodes}
          edges={batchEdges}
          lineages={batchLineages ?? []}
          onTrace={drillDownToApplication}
        />
      );
    }
    const sankeyData = filteredSankey ?? batchData.sankey;
    // No application, or nothing but zeros: there is no balance to draw.
    const noLineages = (filteredBatchLineages?.length ?? 0) === 0;
    if (noLineages || sankeyData.columns.every((column) => column.massKg === 0)) {
      return (
        <SankeyEmpty
          reason={noLineages ? (selectedRunId ? "run-filtered" : "none-applied") : "no-dry-mass"}
          onOpenFlow={() => handleViewChange(DEFAULT_BATCH_VIEW, DEFAULT_BATCH_VIEW)}
        />
      );
    }
    return (
      <BatchSankey
        sankey={sankeyData}
        lineages={batchLineages ?? []}
        batchCode={batchData.batch.code}
      />
    );
  })();

  if (!facilityId) {
    return (
      <div className="container-max page-shell">
        <PageHeader
          title="Traceability"
        />
        <SelectFacilityEmptyState description="Choose a facility from the sidebar to trace its provenance." />
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-var(--platform-admin-bar-height))] bg-[var(--bg)] text-[var(--color-text-primary)]">
      {/* Not a <main>: the app shell already provides the #main-content
          landmark, and a document must expose only one. */}
      <div className="flex flex-col h-[calc(100vh-var(--platform-admin-bar-height))]">
        {/* Horizontal rhythm matches the app shell (container-max); only the
            canvas below is full-bleed. */}
        <header className="shrink-0 border-b border-[var(--color-border-secondary)]">
          <TraceabilityHeader
            facility={facility ?? null}
            batches={batchSelection.batches}
            selectedBatchId={selectedBatchId}
            batchesLoading={batchSelection.isLoading}
            batchesError={batchSelection.isError}
            batchesErrorDetail={batchSelection.error}
            onSelectBatch={handleBatchChange}
            anchor={anchor}
            runOptions={runOptions}
            showRunFilter={batchView !== TRACEABILITY_ACTIVITY_VIEW}
            selectedRunId={selectedRunId}
            onRunChange={handleRunChange}
            runFilterDisabled={batchLoading || runOptions.length === 0}
            showBackToBatch={anchor === "application" && !!selectedBatchId}
            onBackToBatch={backToBatch}
            showMassToggle={showMassToggle}
            massUnit={massUnit}
            onMassUnitChange={setMassUnit}
            viewModes={viewModes}
            activeView={activeView}
            defaultView={defaultView}
            onViewChange={handleViewChange}
          />
        </header>

        <div className="flex-1 min-h-0 relative">
          {anchor === "none" ? (
            batchSelection.isLoading ? (
              <CenteredMessage>
                Loading this facility&apos;s credit batches…
              </CenteredMessage>
            ) : batchSelection.isError ? (
              // The picker's 40px band can only truncate a failure. The canvas
              // is free, so the full message and the way out live here.
              <NoBatchesState
                title="Credit batches could not be loaded"
                description={
                  batchSelection.error?.message ??
                  "Refresh the page to try again. If it keeps failing, the facility's credit batches may still be indexing."
                }
              />
            ) : batchSelection.batches.length === 0 ? (
              <NoBatchesState
                title="Nothing to trace yet"
                description="This facility has no credit batches. Create one from Credit batches, then come back to trace its provenance."
                action={
                  <Button variant="weak" onClick={() => router.push("/credit-batches")}>
                    Go to credit batches
                  </Button>
                }
              />
            ) : (
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
      </div>

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
