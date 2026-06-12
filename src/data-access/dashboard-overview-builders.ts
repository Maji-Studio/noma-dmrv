import type {
  DashboardAttentionItem,
  DashboardFacilityOption,
  DashboardNowItem,
  DashboardProgressStage,
  DashboardTone,
  StatusCount,
  TransportAggregate,
} from "./dashboard-overview";

const MAX_NOW_ITEMS = 10;

interface RunningRunRow {
  id: string;
  code: string;
  facilityId: string;
  startTime: Date;
}

interface CompletedRunRow {
  id: string;
  code: string;
  facilityId: string;
  date: string;
}

interface RunWithoutSamplesRow {
  id: string;
  code: string;
  facilityId: string;
  date: string;
}

interface CreditBatchRow {
  id: string;
  code: string;
  facilityId: string;
  status: string;
  endDate: string;
  totalCo2eStoredTons: number | null;
  applicationCount: number | null;
}

interface RemovalRow {
  id: string;
  facilityId: string;
  completedOn: string | null;
  status: string | null;
  submittedAt: Date | null;
  lockedAt: Date | null;
  externalId: string | null;
}

interface GhgStatementRow {
  id: string;
  facilityId: string;
  reportingPeriodEndOn: string;
  status: string | null;
  submittedAt: Date | null;
  lockedAt: Date | null;
  externalId: string | null;
}

interface MissingApplicationGpsRow {
  id: string;
  code: string;
  facilityId: string;
  applicationDate: Date;
}

export interface DashboardStatusCounts {
  feedstocks: StatusCount[];
  productionRuns: StatusCount[];
  biocharProducts: StatusCount[];
  deliveries: StatusCount[];
  applications: StatusCount[];
  creditBatches: StatusCount[];
}

function countByStatus(rows: StatusCount[], statuses: string[]): number {
  const wanted = new Set(statuses);
  return rows
    .filter((row) => wanted.has(row.status))
    .reduce((sum, row) => sum + Number(row.count), 0);
}

function facilityHref(path: string, facilityId: string): string {
  return `${path}?facility=${encodeURIComponent(facilityId)}`;
}

function removalHref(facilityId: string, removalId: string): string {
  return `/certification/removals?facility=${encodeURIComponent(
    facilityId,
  )}&removal=${encodeURIComponent(removalId)}`;
}

function statementHref(facilityId: string, statementId: string): string {
  return `/certification/ghg-statements?facility=${encodeURIComponent(
    facilityId,
  )}&statement=${encodeURIComponent(statementId)}`;
}

function facilityLabel(
  facilityById: Map<string, DashboardFacilityOption>,
  facilityId: string,
) {
  const facility = facilityById.get(facilityId);
  return {
    facilityCode: facility?.code ?? "FAC",
    facilityName: facility?.name ?? "Unknown facility",
  };
}

function addAttention(
  items: DashboardAttentionItem[],
  item: DashboardAttentionItem,
) {
  items.push(item);
}

export function attentionPriority(tone: DashboardTone): number {
  switch (tone) {
    case "critical":
      return 0;
    case "blocked":
      return 1;
    case "ready":
      return 2;
    case "running":
      return 3;
    case "waiting":
      return 4;
  }
}

export function buildSubmissionAttention(args: {
  removalRows: RemovalRow[];
  statementRows: GhgStatementRow[];
  facilityById: Map<string, DashboardFacilityOption>;
}): DashboardAttentionItem[] {
  const items: DashboardAttentionItem[] = [];

  for (const row of args.removalRows) {
    const facility = facilityLabel(args.facilityById, row.facilityId);
    if (row.status === "rejected") {
      addAttention(items, {
        id: `removal-rejected-${row.id}`,
        tone: "critical",
        label: "Submission",
        title: "Removal submission rejected",
        detail: row.completedOn
          ? `Reporting window ended ${row.completedOn}`
          : "Open the review flow and resolve the registry response.",
        facilityId: row.facilityId,
        ...facility,
        href: removalHref(row.facilityId, row.id),
        entityCode: row.externalId ?? row.id.slice(0, 8),
        occurredAt: row.submittedAt?.toISOString() ?? null,
      });
    } else if (row.status === "submitted") {
      addAttention(items, {
        id: `removal-submitted-${row.id}`,
        tone: "waiting",
        label: "Registry",
        title: "Removal submitted",
        detail: "Submitted to the registry; include it in a GHG Statement when ready.",
        facilityId: row.facilityId,
        ...facility,
        href: removalHref(row.facilityId, row.id),
        entityCode: row.externalId ?? row.id.slice(0, 8),
        occurredAt: row.submittedAt?.toISOString() ?? null,
      });
    } else if (!row.status || row.status === "draft") {
      addAttention(items, {
        id: `removal-draft-${row.id}`,
        tone: "ready",
        label: "Review",
        title: "Removal waiting for pre-flight review",
        detail: row.completedOn
          ? `Reporting window ended ${row.completedOn}`
          : "Open the removal and check submission readiness.",
        facilityId: row.facilityId,
        ...facility,
        href: removalHref(row.facilityId, row.id),
        entityCode: row.id.slice(0, 8),
        occurredAt: null,
      });
    }
  }

  for (const row of args.statementRows) {
    const facility = facilityLabel(args.facilityById, row.facilityId);
    if (row.status === "rejected") {
      addAttention(items, {
        id: `statement-rejected-${row.id}`,
        tone: "critical",
        label: "Verifier",
        title: "GHG Statement verification failed",
        detail: `Reporting period ended ${row.reportingPeriodEndOn}`,
        facilityId: row.facilityId,
        ...facility,
        href: statementHref(row.facilityId, row.id),
        entityCode: row.externalId ?? row.id.slice(0, 8),
        occurredAt: row.submittedAt?.toISOString() ?? null,
      });
    } else if (row.status === "submitted") {
      addAttention(items, {
        id: `statement-submitted-${row.id}`,
        tone: "waiting",
        label: "Verifier",
        title: "GHG Statement awaiting verifier",
        detail: `Reporting period ended ${row.reportingPeriodEndOn}`,
        facilityId: row.facilityId,
        ...facility,
        href: statementHref(row.facilityId, row.id),
        entityCode: row.externalId ?? row.id.slice(0, 8),
        occurredAt: row.submittedAt?.toISOString() ?? null,
      });
    }
  }

  return items;
}

export function buildEvidenceAttention(args: {
  missingApplications: MissingApplicationGpsRow[];
  runsWithoutSamples: RunWithoutSamplesRow[];
  transportAggregates: TransportAggregate[];
  facilityById: Map<string, DashboardFacilityOption>;
}): DashboardAttentionItem[] {
  const items: DashboardAttentionItem[] = [];

  for (const row of args.runsWithoutSamples) {
    const facility = facilityLabel(args.facilityById, row.facilityId);
    addAttention(items, {
      id: `run-samples-${row.id}`,
      tone: "blocked",
      label: "Evidence",
      title: "Production run has no lab sample",
      detail: `Completed on ${row.date}; add sample evidence before certification.`,
      facilityId: row.facilityId,
      ...facility,
      href: facilityHref(`/production-runs/${row.id}`, row.facilityId),
      entityCode: row.code,
      occurredAt: row.date,
    });
  }

  for (const row of args.missingApplications) {
    const facility = facilityLabel(args.facilityById, row.facilityId);
    addAttention(items, {
      id: `application-gps-${row.id}`,
      tone: "blocked",
      label: "Map",
      title: "Application missing GPS",
      detail: "The application field cannot be plotted in the custody map.",
      facilityId: row.facilityId,
      ...facility,
      href: facilityHref("/applications", row.facilityId),
      entityCode: row.code,
      occurredAt: row.applicationDate.toISOString(),
    });
  }

  for (const row of args.transportAggregates) {
    if (row.endpointGaps === 0 && row.distanceEvidenceGaps === 0) continue;
    const facility = facilityLabel(args.facilityById, row.facilityId);
    addAttention(items, {
      id: `transport-gaps-${row.facilityId}`,
      tone: row.endpointGaps > 0 ? "blocked" : "ready",
      label: "Transport",
      title: "Transport provenance needs review",
      detail:
        row.endpointGaps > 0
          ? `${row.endpointGaps} transport leg${row.endpointGaps === 1 ? "" : "s"} cannot be plotted.`
          : `${row.distanceEvidenceGaps} route distance${row.distanceEvidenceGaps === 1 ? "" : "s"} are not document-backed.`,
      facilityId: row.facilityId,
      ...facility,
      href: facilityHref("/chain-of-custody", row.facilityId),
      entityCode: null,
      occurredAt: null,
    });
  }

  return items;
}

export function buildProductionAttention(args: {
  runningRuns: RunningRunRow[];
  facilityById: Map<string, DashboardFacilityOption>;
}): DashboardAttentionItem[] {
  return args.runningRuns.map((row) => {
    const facility = facilityLabel(args.facilityById, row.facilityId);
    return {
      id: `running-run-${row.id}`,
      tone: "running" as const,
      label: "Now",
      title: "Production run is running",
      detail: `Started ${row.startTime.toISOString()}`,
      facilityId: row.facilityId,
      ...facility,
      href: facilityHref(`/production-runs/${row.id}`, row.facilityId),
      entityCode: row.code,
      occurredAt: row.startTime.toISOString(),
    };
  });
}

export function buildCreditBatchAttention(args: {
  creditBatchRows: CreditBatchRow[];
  facilityById: Map<string, DashboardFacilityOption>;
}): DashboardAttentionItem[] {
  return args.creditBatchRows.map((row) => {
    const applicationCount = Number(row.applicationCount ?? 0);
    const facility = facilityLabel(args.facilityById, row.facilityId);
    const critical = row.status === "rejected";
    const missingApplications = applicationCount === 0;
    const missingCo2e = row.totalCo2eStoredTons == null;

    return {
      id: `credit-batch-${row.id}`,
      tone: critical ? "critical" : "blocked",
      label: "Credit batch",
      title: critical ? "Credit batch rejected" : "Credit batch needs review",
      detail: missingApplications
        ? "No applications are linked to this batch."
        : missingCo2e
          ? "CO2e stored has not resolved from the batch inputs."
          : `Status is ${row.status}; review before grouping into a removal.`,
      facilityId: row.facilityId,
      ...facility,
      href: facilityHref(`/credit-batches/${row.id}`, row.facilityId),
      entityCode: row.code,
      occurredAt: row.endDate,
    };
  });
}

export function buildNowItems(args: {
  runningRuns: RunningRunRow[];
  recentCompletedRuns: CompletedRunRow[];
  removalRows: RemovalRow[];
  statementRows: GhgStatementRow[];
  facilityById: Map<string, DashboardFacilityOption>;
}): DashboardNowItem[] {
  const items: DashboardNowItem[] = [];

  for (const row of args.runningRuns) {
    const facility = facilityLabel(args.facilityById, row.facilityId);
    items.push({
      id: `now-running-${row.id}`,
      label: "Production",
      title: row.code,
      detail: `Running at ${facility.facilityCode}`,
      status: "running",
      facilityCode: facility.facilityCode,
      href: facilityHref(`/production-runs/${row.id}`, row.facilityId),
    });
  }

  for (const row of args.recentCompletedRuns) {
    const facility = facilityLabel(args.facilityById, row.facilityId);
    items.push({
      id: `now-complete-${row.id}`,
      label: "Production",
      title: row.code,
      detail: `Completed ${row.date}`,
      status: "complete",
      facilityCode: facility.facilityCode,
      href: facilityHref(`/production-runs/${row.id}`, row.facilityId),
    });
  }

  for (const row of args.removalRows) {
    if (row.status !== "submitted" && row.lockedAt == null) continue;
    const facility = facilityLabel(args.facilityById, row.facilityId);
    items.push({
      id: `now-removal-${row.id}`,
      label: "Registry",
      title: row.externalId ?? row.id.slice(0, 8),
      detail: row.lockedAt ? "Submission in progress" : "Removal submitted",
      status: row.lockedAt ? "locked" : "submitted",
      facilityCode: facility.facilityCode,
      href: removalHref(row.facilityId, row.id),
    });
  }

  for (const row of args.statementRows) {
    if (row.status !== "submitted" && row.lockedAt == null) continue;
    const facility = facilityLabel(args.facilityById, row.facilityId);
    items.push({
      id: `now-statement-${row.id}`,
      label: "Verifier",
      title: row.externalId ?? row.id.slice(0, 8),
      detail: row.lockedAt ? "Statement submission in progress" : "Awaiting verifier",
      status: row.lockedAt ? "locked" : "submitted",
      facilityCode: facility.facilityCode,
      href: statementHref(row.facilityId, row.id),
    });
  }

  return items.slice(0, MAX_NOW_ITEMS);
}

export function buildProgress(args: {
  counts: DashboardStatusCounts;
  creditBatchRows: CreditBatchRow[];
  removalRows: RemovalRow[];
  statementRows: GhgStatementRow[];
}): DashboardProgressStage[] {
  const removalAttention = args.removalRows.filter(
    (row) => !row.status || row.status === "draft" || row.status === "rejected",
  ).length;
  const statementAttention = args.statementRows.filter(
    (row) => row.status === "submitted" || row.status === "rejected",
  ).length;
  const creditBatchAttention = args.creditBatchRows.length;

  return [
    {
      key: "feedstock",
      label: "Feedstock",
      total: countByStatus(args.counts.feedstocks, ["missing_data", "complete"]),
      needsAttention: countByStatus(args.counts.feedstocks, ["missing_data"]),
      detail: "Missing data blocks production lineage.",
      href: "/feedstocks",
    },
    {
      key: "production",
      label: "Production runs",
      total: countByStatus(args.counts.productionRuns, [
        "draft",
        "running",
        "complete",
        "void",
      ]),
      needsAttention: countByStatus(args.counts.productionRuns, [
        "draft",
        "running",
      ]),
      detail: "Draft and running runs need follow-through.",
      href: "/production-runs",
    },
    {
      key: "products",
      label: "Biochar products",
      total: countByStatus(args.counts.biocharProducts, [
        "draft",
        "testing",
        "ready",
        "sold",
      ]),
      needsAttention: countByStatus(args.counts.biocharProducts, [
        "draft",
        "testing",
      ]),
      detail: "Testing products are not ready for distribution.",
      href: "/biochar-products",
    },
    {
      key: "deliveries",
      label: "Deliveries",
      total: countByStatus(args.counts.deliveries, ["upcoming", "delivered"]),
      needsAttention: countByStatus(args.counts.deliveries, ["upcoming"]),
      detail: "Upcoming deliveries are still in motion.",
      href: "/deliveries",
    },
    {
      key: "applications",
      label: "Applications",
      total: countByStatus(args.counts.applications, ["delivered", "applied"]),
      needsAttention: countByStatus(args.counts.applications, ["delivered"]),
      detail: "Delivered biochar still needs application.",
      href: "/applications",
    },
    {
      key: "creditBatches",
      label: "Credit batches",
      total: countByStatus(args.counts.creditBatches, [
        "draft",
        "pending",
        "verified",
        "issued",
        "rejected",
      ]),
      needsAttention: creditBatchAttention,
      detail: "Batches need complete applications and carbon inputs.",
      href: "/credit-batches",
    },
    {
      key: "removals",
      label: "Removals",
      total: args.removalRows.length,
      needsAttention: removalAttention,
      detail: "Submission units moving toward the registry.",
      href: "/certification/removals",
    },
    {
      key: "statements",
      label: "GHG Statements",
      total: args.statementRows.length,
      needsAttention: statementAttention,
      detail: "Verifier-facing reporting-period artifacts.",
      href: "/certification/ghg-statements",
    },
  ];
}
