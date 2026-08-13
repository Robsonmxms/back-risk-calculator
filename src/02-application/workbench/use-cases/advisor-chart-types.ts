import { ClientStatus } from "../../../01-domain/clients/client";
import { ReportPackageStatus } from "../../../01-domain/delivery/report-package";
import { ReviewItemSeverity } from "../../../01-domain/workbench/workbench";
import { AlertSeverity } from "../../../01-domain/reports-alerts/types";
import { DataQualityIssue } from "../../../01-domain/analytics/types";

export type AdvisorChartRange = "30d" | "90d" | "ytd" | "1y" | "all";
export type AdvisorRiskBand = "low" | "watch" | "high";
export type AdvisorFreshness = "fresh" | "partial" | "stale";
export type AdvisorAssignmentScope = "advisor" | "office_admin";
export type AdvisorChartDataQualityStatus = AdvisorFreshness | "empty";

export interface AdvisorChartsQuery {
  advisorUserId?: string;
  teamId?: string;
  range: AdvisorChartRange;
  clientStatus?: string;
  riskBand?: AdvisorRiskBand;
  freshness?: AdvisorFreshness;
}

export interface AdvisorDrillDownLink {
  clientId?: string;
  householdId?: string;
  portfolioId?: string;
  reportPackageId?: string;
  alertId?: string;
  reviewItemId?: string;
}

export interface AdvisorBookValueTrendPoint {
  date: string;
  value: number;
  clientCount: number;
  portfolioCount: number;
}

export interface AdvisorRiskReturnPoint {
  id: string;
  clientId?: string;
  clientName?: string;
  householdId?: string;
  householdName?: string;
  portfolioId: string;
  portfolioName: string;
  value: number;
  annualizedReturnPercent?: number;
  volatilityPercent?: number;
  maxDrawdownPercent?: number;
  sharpeRatio?: number;
  riskBand: AdvisorRiskBand;
  freshness: AdvisorFreshness;
  drillDown: AdvisorDrillDownLink;
}

export interface AdvisorClientRiskDistributionPoint {
  clientId: string;
  clientName: string;
  householdId?: string;
  householdName?: string;
  value: number;
  portfolioCount: number;
  riskBand: AdvisorRiskBand;
  freshness: AdvisorFreshness;
  drillDown: AdvisorDrillDownLink;
}

export interface AdvisorSectorHeatmapCell {
  clientId: string;
  clientName: string;
  householdId?: string;
  sector: string;
  weightPercent: number;
  marketValueUsd: number;
  drillDown: AdvisorDrillDownLink;
}

export interface AdvisorAllocationBreakdownPoint {
  label: string;
  weightPercent: number;
  marketValueUsd: number;
}

export interface AdvisorAlertSeverityTimelinePoint {
  date: string;
  low: number;
  medium: number;
  high: number;
  total: number;
}

export interface AdvisorReportPipelinePoint {
  status: ReportPackageStatus;
  count: number;
  clientCount: number;
  staleCount: number;
  latestUpdatedAt?: string;
}

export interface AdvisorWorkbenchAgingPoint {
  bucket: "overdue" | "due_7d" | "due_30d" | "no_due_date";
  low: number;
  medium: number;
  high: number;
  total: number;
}

export interface AdvisorStaleDataBacklogItem {
  portfolioId: string;
  portfolioName: string;
  clientId?: string;
  clientName?: string;
  householdId?: string;
  householdName?: string;
  freshness: AdvisorFreshness;
  analyticsState: string;
  marketDataState: string;
  reason: string;
  daysSinceLastTransaction?: number;
  drillDown: AdvisorDrillDownLink;
}

export interface AdvisorNeedsAttentionItem {
  rank: number;
  clientId: string;
  clientName: string;
  householdId?: string;
  householdName?: string;
  score: number;
  reasons: string[];
  value: number;
  riskBand: AdvisorRiskBand;
  freshness: AdvisorFreshness;
  openReviewItemCount: number;
  highAlertCount: number;
  pendingReportCount: number;
  drillDown: AdvisorDrillDownLink;
}

export interface AdvisorChartBundle {
  officeId: string;
  advisorUserId: string;
  range: AdvisorChartRange;
  filters: {
    teamId?: string;
    clientStatus: ClientStatus[];
    riskBand?: AdvisorRiskBand;
    freshness?: AdvisorFreshness;
  };
  charts: {
    bookValueTrend: AdvisorBookValueTrendPoint[];
    riskReturnScatter: AdvisorRiskReturnPoint[];
    drawdownDistribution: AdvisorClientRiskDistributionPoint[];
    volatilityDistribution: AdvisorClientRiskDistributionPoint[];
    sectorExposureHeatmap: AdvisorSectorHeatmapCell[];
    allocationBreakdown: AdvisorAllocationBreakdownPoint[];
    alertSeverityTimeline: AdvisorAlertSeverityTimelinePoint[];
    reportPipeline: AdvisorReportPipelinePoint[];
    workbenchAging: AdvisorWorkbenchAgingPoint[];
    staleDataBacklog: AdvisorStaleDataBacklogItem[];
  };
  rankings: {
    needsAttention: AdvisorNeedsAttentionItem[];
  };
  dataQuality: {
    status: AdvisorChartDataQualityStatus;
    issues: DataQualityIssue[];
    sourceCounts: {
      clients: number;
      households: number;
      portfolios: number;
      analyticsSnapshots: number;
      reportPackages: number;
      alerts: number;
      reviewItems: number;
    };
  };
}

export interface AdvisorChartsResponse {
  data: AdvisorChartBundle;
  meta: {
    generatedAt: string;
    assignmentScope: AdvisorAssignmentScope;
  };
}

export type SeverityCounts = Record<ReviewItemSeverity, number>;
export type AlertSeverityCounts = Record<AlertSeverity, number>;
