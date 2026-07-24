import {
  AuditOutcome,
  AuditResourceType,
  AuditSeverity,
  SupervisionReviewStatus
} from "../../../01-domain/compliance/audit";
import { ReportPackageStatus } from "../../../01-domain/delivery/report-package";
import { ReportStatus, NotificationStatus } from "../../../modules/reports-alerts/types";
import { DataQualityIssue } from "../../../modules/analytics/types";

export type ComplianceDeliveryChartRange = "7d" | "30d" | "90d" | "ytd" | "1y" | "all";
export type ComplianceDeliveryDataQualityStatus = "complete" | "partial" | "empty";

export interface ComplianceChartsQuery {
  range: ComplianceDeliveryChartRange;
  resourceType?: AuditResourceType;
  action?: string;
  severity?: AuditSeverity;
  status?: SupervisionReviewStatus;
  assigneeUserId?: string;
}

export interface DeliveryChartsQuery {
  range: ComplianceDeliveryChartRange;
  packageStatus?: ReportPackageStatus;
  deliveryStatus?: ReportPackageStatus | ReportStatus | NotificationStatus | AuditOutcome;
  channel?: string;
  clientId?: string;
  householdId?: string;
  advisorUserId?: string;
}

export interface AuditEventTimelinePoint {
  date: string;
  success: number;
  failure: number;
  info: number;
  warning: number;
  critical: number;
  total: number;
  eventIds: string[];
  clientIds: string[];
  portfolioIds: string[];
}

export interface AuditActionBreakdownPoint {
  action: string;
  resourceType: AuditResourceType;
  outcome: AuditOutcome;
  severity: AuditSeverity;
  count: number;
  eventIds: string[];
}

export interface ReviewStatusFunnelPoint {
  status: SupervisionReviewStatus;
  count: number;
  reviewIds: string[];
  auditEventIds: string[];
}

export interface ReviewAgingPoint {
  bucket: "0-1d" | "2-3d" | "4-7d" | "8-14d" | "15d+";
  count: number;
  reviewIds: string[];
  auditEventIds: string[];
}

export interface PermissionActivityPoint {
  date: string;
  created: number;
  revoked: number;
  roleChanges: number;
  total: number;
  eventIds: string[];
}

export interface ExceptionHeatmapPoint {
  date: string;
  severity: AuditSeverity;
  count: number;
  eventIds: string[];
}

export interface ComplianceChartBundle {
  officeId: string;
  range: ComplianceDeliveryChartRange;
  filters: Omit<ComplianceChartsQuery, "range">;
  charts: {
    auditEventTimeline: AuditEventTimelinePoint[];
    auditActionBreakdown: AuditActionBreakdownPoint[];
    reviewStatusFunnel: ReviewStatusFunnelPoint[];
    reviewAging: ReviewAgingPoint[];
    permissionActivity: PermissionActivityPoint[];
    exceptionHeatmap: ExceptionHeatmapPoint[];
  };
  dataQuality: {
    status: ComplianceDeliveryDataQualityStatus;
    issues: DataQualityIssue[];
    sourceCounts: {
      auditEvents: number;
      supervisionReviews: number;
      redactedAuditMetadataFields: number;
    };
  };
}

export interface ReportLifecycleFunnelPoint {
  status: ReportPackageStatus;
  count: number;
  reportPackageIds: string[];
  clientIds: string[];
}

export interface ApprovalLatencyPoint {
  bucket: "0-4h" | "4-24h" | "1-3d" | "3d+";
  count: number;
  averageHours: number;
  reportPackageIds: string[];
}

export interface DeliveryOutcomeTimelinePoint {
  date: string;
  delivered: number;
  viewed: number;
  failed: number;
  revoked: number;
  total: number;
  reportPackageIds: string[];
  eventIds: string[];
}

export interface FailureReasonBreakdownPoint {
  failureCode: string;
  channel?: string;
  count: number;
  eventIds: string[];
  reportPackageIds: string[];
}

export interface NotificationReadStatusPoint {
  status: NotificationStatus;
  count: number;
  notificationIds: string[];
}

export interface ClientPackageReadinessPoint {
  clientId: string;
  clientName: string;
  householdId?: string;
  readyCount: number;
  pendingCount: number;
  failedItemCount: number;
  staleNotificationCount: number;
  latestPackageStatus?: ReportPackageStatus;
  latestPackageUpdatedAt?: string;
  reportPackageIds: string[];
  notificationIds: string[];
}

export interface DeliveryChartBundle {
  officeId: string;
  range: ComplianceDeliveryChartRange;
  filters: Omit<DeliveryChartsQuery, "range">;
  charts: {
    reportLifecycleFunnel: ReportLifecycleFunnelPoint[];
    approvalLatency: ApprovalLatencyPoint[];
    deliveryOutcomeTimeline: DeliveryOutcomeTimelinePoint[];
    failureReasonBreakdown: FailureReasonBreakdownPoint[];
    notificationReadStatus: NotificationReadStatusPoint[];
    clientPackageReadiness: ClientPackageReadinessPoint[];
  };
  dataQuality: {
    status: ComplianceDeliveryDataQualityStatus;
    issues: DataQualityIssue[];
    sourceCounts: {
      clients: number;
      portfolios: number;
      reportPackages: number;
      reports: number;
      notifications: number;
      deliveryAuditEvents: number;
    };
  };
}

export interface ComplianceChartsResponse {
  data: ComplianceChartBundle;
  meta: {
    generatedAt: string;
    calculationDurationMs: number;
  };
}

export interface DeliveryChartsResponse {
  data: DeliveryChartBundle;
  meta: {
    generatedAt: string;
    calculationDurationMs: number;
  };
}
