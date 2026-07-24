import { OfficeMembershipRole, OfficeStatus } from "../../../01-domain/offices/office";
import { AnalyticsJobStatus, DataQualityIssue } from "../../../modules/analytics/types";
import {
  MarketDataFreshness,
  MarketDataRequestStatus
} from "../../../modules/market-data/types";
import {
  AlertSeverity,
  NotificationStatus,
  ReportStatus
} from "../../../modules/reports-alerts/types";
import {
  ClientOnboardingStatus,
  ClientStatus
} from "../../../01-domain/clients/client";
import { ReportPackageStatus } from "../../../01-domain/delivery/report-package";

export type OfficeAdminChartRange = "7d" | "30d" | "90d" | "ytd" | "1y" | "all";

export type OfficeAdminWorkflowStatus =
  | ClientStatus
  | ClientOnboardingStatus
  | ReportPackageStatus
  | ReportStatus
  | AnalyticsJobStatus
  | MarketDataRequestStatus
  | NotificationStatus
  | "open"
  | "monitoring"
  | "disabled";

export type OfficeAdminSeverityFilter =
  | AlertSeverity
  | "info"
  | "warning"
  | "critical";

export interface OfficeAdminChartsQuery {
  range: OfficeAdminChartRange;
  role?: OfficeMembershipRole;
  workflowStatus?: OfficeAdminWorkflowStatus;
  provider?: string;
  severity?: OfficeAdminSeverityFilter;
}

export type OfficeAdminDataQualityStatus = "complete" | "partial" | "stale" | "empty";

export interface OfficeClientGrowthPoint {
  date: string;
  clients: number;
  households: number;
  accounts: number;
  portfolios: number;
  staff: number;
  clientIds: string[];
  householdIds: string[];
  portfolioIds: string[];
  staffUserIds: string[];
}

export interface OfficeOnboardingFunnelPoint {
  status: ClientOnboardingStatus;
  count: number;
  clientIds: string[];
}

export interface OfficeStaffRoleDistributionPoint {
  role: OfficeMembershipRole;
  count: number;
  userIds: string[];
}

export interface OfficeAssignmentLoadPoint {
  assigneeUserId?: string;
  assigneeName: string;
  role?: OfficeMembershipRole;
  teamId?: string;
  teamName?: string;
  clientCount: number;
  householdCount: number;
  accountCount: number;
  portfolioCount: number;
  totalAssignments: number;
  assignmentIds: string[];
}

export interface OfficeCoveragePoint {
  status: string;
  freshness: MarketDataFreshness;
  count: number;
  totalCostBasis: number;
  portfolioIds: string[];
}

export interface OfficeAssetCoveragePoint {
  assetSymbol: string;
  assetName: string;
  portfolioCount: number;
  totalQuantity: number;
  totalCostBasis: number;
  portfolioIds: string[];
}

export interface OfficeMarketDataFreshnessPoint {
  providerName: string;
  status: "available" | "degraded" | "unavailable" | "unconfigured";
  freshness: MarketDataFreshness;
  requestCount: number;
  errorCount: number;
  averageLatencyMs: number;
  jobCount: number;
  failedJobCount: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastErrorCode?: string;
}

export interface OfficeAnalyticsQueueHealthPoint {
  status: AnalyticsJobStatus | "missing";
  count: number;
  failedCount: number;
  portfolioIds: string[];
  latestUpdatedAt?: string;
}

export interface OfficeReportThroughputPoint {
  status: ReportStatus | ReportPackageStatus;
  count: number;
  portfolioCount: number;
  reportIds: string[];
  reportPackageIds: string[];
  latestUpdatedAt?: string;
}

export interface OfficeReportFailurePoint {
  failureCode: string;
  count: number;
  reportIds: string[];
  portfolioIds: string[];
  latestFailedAt?: string;
}

export interface OfficeAlertNotificationVolumePoint {
  date: string;
  low: number;
  medium: number;
  high: number;
  info: number;
  total: number;
  alertIds: string[];
  notificationIds: string[];
}

export interface OfficePermissionActivityPoint {
  date: string;
  created: number;
  revoked: number;
  roleChanges: number;
  total: number;
  eventIds: string[];
  assignmentIds: string[];
}

export interface OfficeAdminChartBundle {
  officeId: string;
  range: OfficeAdminChartRange;
  filters: {
    role?: OfficeMembershipRole;
    workflowStatus?: OfficeAdminWorkflowStatus;
    provider?: string;
    severity?: OfficeAdminSeverityFilter;
  };
  charts: {
    clientGrowth: OfficeClientGrowthPoint[];
    onboardingFunnel: OfficeOnboardingFunnelPoint[];
    staffRoleDistribution: OfficeStaffRoleDistributionPoint[];
    assignmentLoad: OfficeAssignmentLoadPoint[];
    portfolioCoverage: OfficeCoveragePoint[];
    assetCoverage: OfficeAssetCoveragePoint[];
    marketDataFreshness: OfficeMarketDataFreshnessPoint[];
    analyticsQueueHealth: OfficeAnalyticsQueueHealthPoint[];
    reportThroughput: OfficeReportThroughputPoint[];
    reportFailures: OfficeReportFailurePoint[];
    alertNotificationVolume: OfficeAlertNotificationVolumePoint[];
    permissionActivity: OfficePermissionActivityPoint[];
  };
  dataQuality: {
    status: OfficeAdminDataQualityStatus;
    issues: DataQualityIssue[];
    sourceCounts: {
      clients: number;
      households: number;
      accounts: number;
      portfolios: number;
      staff: number;
      assignments: number;
      analyticsJobs: number;
      reports: number;
      reportPackages: number;
      alerts: number;
      notifications: number;
      auditEvents: number;
    };
  };
}

export interface PlatformOfficeStatusPoint {
  status: OfficeStatus;
  count: number;
}

export interface PlatformStaffRoleDistributionPoint {
  role: OfficeMembershipRole;
  count: number;
}

export interface PlatformOfficeVolumePoint {
  bucket: "offices" | "clients" | "households" | "accounts" | "portfolios" | "staff";
  count: number;
}

export interface PlatformTenantFreshnessPoint {
  freshness: MarketDataFreshness;
  officeCount: number;
  portfolioCount: number;
}

export interface PlatformJobHealthPoint {
  kind: "analytics" | "market_data" | "report";
  status: string;
  count: number;
}

export interface PlatformProviderHealthPoint {
  providerName: string;
  status: "available" | "degraded" | "unavailable" | "unconfigured";
  requestCount: number;
  errorCount: number;
  averageLatencyMs: number;
}

export interface PlatformAdminChartBundle {
  platformId: "global";
  range: OfficeAdminChartRange;
  filters: {
    role?: OfficeMembershipRole;
    workflowStatus?: OfficeAdminWorkflowStatus;
    provider?: string;
    severity?: OfficeAdminSeverityFilter;
  };
  charts: {
    officeStatusDistribution: PlatformOfficeStatusPoint[];
    officeVolume: PlatformOfficeVolumePoint[];
    staffRoleDistribution: PlatformStaffRoleDistributionPoint[];
    tenantDataFreshness: PlatformTenantFreshnessPoint[];
    providerHealth: PlatformProviderHealthPoint[];
    jobHealth: PlatformJobHealthPoint[];
    reportThroughput: Array<Omit<OfficeReportThroughputPoint, "reportIds" | "reportPackageIds">>;
    alertNotificationVolume: Array<Omit<OfficeAlertNotificationVolumePoint, "alertIds" | "notificationIds">>;
    permissionActivity: Array<Omit<OfficePermissionActivityPoint, "eventIds" | "assignmentIds">>;
  };
  dataQuality: {
    status: OfficeAdminDataQualityStatus;
    issues: DataQualityIssue[];
    sourceCounts: {
      offices: number;
      clients: number;
      households: number;
      accounts: number;
      portfolios: number;
      staff: number;
      assignments: number;
      analyticsJobs: number;
      marketDataJobs: number;
      reports: number;
      reportPackages: number;
      alerts: number;
      notifications: number;
      auditEvents: number;
    };
  };
}

export interface OfficeAdminChartsResponse {
  data: OfficeAdminChartBundle;
  meta: {
    generatedAt: string;
    calculationDurationMs: number;
  };
}

export interface PlatformAdminChartsResponse {
  data: PlatformAdminChartBundle;
  meta: {
    generatedAt: string;
    calculationDurationMs: number;
  };
}
