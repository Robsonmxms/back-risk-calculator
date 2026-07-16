import { AnalyticsMetricKey } from "../analytics/types";

export type ReportFormat = "pdf" | "csv";
export type ReportStatus = "pending" | "running" | "ready" | "failed";
export type AlertSeverity = "low" | "medium" | "high";
export type AlertStatus = "open" | "monitoring" | "disabled";
export type NotificationStatus = "unread" | "read";
export type RealtimeMessageType =
  | "analytics.updated"
  | "analytics.failed"
  | "market_data.updated"
  | "market_data.failed"
  | "report.generated"
  | "report.failed"
  | "notification.sent"
  | "portfolio.updated";

export interface ReportJob {
  id: string;
  portfolioId: string;
  requestedBy: string;
  format: ReportFormat;
  status: ReportStatus;
  fileKey?: string;
  contentType?: string;
  failureCode?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface StoredReportFile {
  fileKey: string;
  contentType: string;
  body: Buffer;
}

export interface AlertCondition {
  eventType:
    | "analytics.updated"
    | "market_data.updated"
    | "report.generated"
    | "metric_threshold";
  metricKey?: AnalyticsMetricKey;
  operator?: "gte" | "lte";
  threshold?: number;
}

export interface AlertRule {
  id: string;
  portfolioId: string;
  createdBy: string;
  title: string;
  severity: AlertSeverity;
  status: AlertStatus;
  condition: AlertCondition;
  createdAt: Date;
  updatedAt: Date;
  lastTriggeredAt?: Date;
}

export interface NotificationRecord {
  id: string;
  portfolioId?: string;
  userId?: string;
  title: string;
  body: string;
  severity: AlertSeverity | "info";
  status: NotificationStatus;
  sourceType: "report" | "alert" | "system";
  sourceId: string;
  createdAt: Date;
  readAt?: Date;
}

export interface RealtimeMessage {
  id: string;
  type: RealtimeMessageType;
  portfolioId?: string;
  userId?: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}
