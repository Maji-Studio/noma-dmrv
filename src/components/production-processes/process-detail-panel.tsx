/**
 * ProcessDetailPanel — the per-process "process view" (ADR 0017 Track 2).
 *
 * A read-only detail surface for one production process that hosts the Method-B
 * affordances the list row can't: the protocol-cited explainer (Isometric only),
 * the non-authoritative unsampled-carbon preview, the trailing-window compliance
 * drift, and the two human actions — unlock Method B (when eligible) and start a
 * new production process (the baseline reset / drift remedy).
 *
 * State lives in the parent list: it passes the live `process` (looked up from
 * the facility query, so it stays fresh across invalidations) and the two action
 * callbacks that open the unlock / reset dialogs.
 */
"use client";

import { LockOpenIcon, ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { SlideOverPanel } from "@/components/ui/slide-over-panel";
import { Button } from "@/components/ui/button";
import { DetailSection, DetailRow, DetailField } from "@/components/ui/detail-panel";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  METHOD_B_SAMPLING_CADENCE_BATCHES,
} from "@/config/certification";
import { MOISTURE_PATHWAY_LABELS } from "@/schemas/production-process";
import { formatDate } from "@/lib/format-utils";
import type { ProductionProcessSummary } from "@/data-access/production-processes";
import { MethodPill } from "./method-pill";
import { MethodBExplainer } from "./method-b-explainer";
import { UnsampledCarbonPreviewCard } from "./unsampled-carbon-preview-card";
import { ProcessDriftWarnings } from "./process-drift-warnings";

interface ProcessDetailPanelProps {
  process: ProductionProcessSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Facility is on Isometric → show the protocol-cited explainer (D5). */
  isIsometric: boolean;
  onUnlock: (process: ProductionProcessSummary) => void;
  onStartNewProcess: (process: ProductionProcessSummary) => void;
}

export function ProcessDetailPanel({
  process,
  open,
  onOpenChange,
  isIsometric,
  onUnlock,
  onStartNewProcess,
}: ProcessDetailPanelProps) {
  const isMethodB = process?.samplingMethod === "method_b";
  const isEligible = !!process && !isMethodB && process.meetsBaseline;

  return (
    <SlideOverPanel.Root open={open} onOpenChange={onOpenChange}>
      <SlideOverPanel.Content size="wide">
        <SlideOverPanel.Header showClose>
          <SlideOverPanel.Title>
            {process ? process.feedstockName : "Production process"}
          </SlideOverPanel.Title>
          {process && (
            <SlideOverPanel.Description>
              {process.feedstockCode} · per-feedstock sampling campaign
            </SlideOverPanel.Description>
          )}
        </SlideOverPanel.Header>

        <SlideOverPanel.Body className="flex flex-col gap-20">
          {process && (
            <>
              <DetailSection title="Sampling regime" divider={false}>
                <DetailRow>
                  <DetailField
                    label="Method"
                    value={<MethodPill method={process.samplingMethod} />}
                  />
                  <DetailField
                    label="Established"
                    value={formatDate(process.establishedAt)}
                  />
                </DetailRow>
                <DetailRow>
                  <DetailField
                    label="Method-B baseline"
                    value={
                      isMethodB ? (
                        "Baseline cleared"
                      ) : (
                        <span className="tabular-nums">
                          {process.eligibleSampleCount} / {process.baselineTarget}{" "}
                          baseline samples
                          {process.futureSampleCount > 0 &&
                            ` (${process.futureSampleCount} future-dated — counted from ${formatDate(process.nextCountableSamplingTime)})`}
                        </span>
                      )
                    }
                  />
                  <DetailField
                    label="Cadence"
                    value={
                      <span className="inline-flex flex-col gap-4">
                        <StatusBadge
                          status={process.cadenceMet ? "complete" : "pending"}
                          label={
                            process.cadenceMet
                              ? "On cadence"
                              : `Sample ${process.cadenceShortfall} more`
                          }
                          size="small"
                        />
                        <span className="body-caption text-[var(--color-text-tertiary)] tabular-nums">
                          {isMethodB
                            ? `${process.sampledBatches}/${process.requiredSampledBatches} batches (≥1 per ${METHOD_B_SAMPLING_CADENCE_BATCHES})`
                            : `${process.sampledBatches}/${process.totalBatches} batches sampled`}
                        </span>
                      </span>
                    }
                  />
                </DetailRow>
                {isMethodB && process.methodBUnlockedAt && (
                  <DetailRow>
                    <DetailField
                      label="Method B unlocked"
                      value={formatDate(process.methodBUnlockedAt)}
                    />
                  </DetailRow>
                )}
              </DetailSection>

              {/* The three protocol prerequisites captured at unlock, surfaced
                  read-only so the declaration is auditable (not write-only). */}
              {isMethodB && process.agreedBaselineSize != null && (
                <DetailSection title="Unlock declaration">
                  <DetailRow>
                    <DetailField
                      label="Agreed baseline (G-F74T-0)"
                      value={`${process.agreedBaselineSize} samples`}
                    />
                    <DetailField
                      label="Moisture pathway (R-ADXG-0)"
                      value={
                        process.moisturePathway
                          ? MOISTURE_PATHWAY_LABELS[process.moisturePathway]
                          : "—"
                      }
                    />
                  </DetailRow>
                  <DetailRow>
                    <DetailField
                      label="Random-sampling plan (R-S8K1-1)"
                      value={process.randomSamplingPlanRef ?? "—"}
                    />
                  </DetailRow>
                </DetailSection>
              )}

              {isIsometric && <MethodBExplainer compact />}

              <UnsampledCarbonPreviewCard processId={process.id} enabled={open} />

              <div className="border-t border-[var(--color-border-tertiary)] pt-16">
                <ProcessDriftWarnings processId={process.id} enabled={open} />
              </div>
            </>
          )}
        </SlideOverPanel.Body>

        <SlideOverPanel.Footer className="justify-stretch">
          {process && !isMethodB && (
            <Button
              variant="primary"
              className="flex-1"
              disabled={!isEligible}
              onClick={() => onUnlock(process)}
            >
              <LockOpenIcon size={18} weight="bold" />
              {isEligible
                ? "Unlock Method B"
                : `${process.baselineTarget - process.eligibleSampleCount} more to qualify`}
            </Button>
          )}
          {process && (
            <Button
              variant="default"
              className="flex-1"
              onClick={() => onStartNewProcess(process)}
            >
              <ArrowsClockwiseIcon size={18} weight="bold" />
              Start new process
            </Button>
          )}
        </SlideOverPanel.Footer>
      </SlideOverPanel.Content>
    </SlideOverPanel.Root>
  );
}
