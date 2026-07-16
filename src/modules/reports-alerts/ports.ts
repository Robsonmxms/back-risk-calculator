import {
  AlertRule,
  NotificationRecord,
  RealtimeMessage,
  ReportJob,
  StoredReportFile
} from "./types";

export interface ReportRepository {
  createReport(job: ReportJob): Promise<ReportJob>;
  findReportById(reportId: string): Promise<ReportJob | undefined>;
  listReportsByPortfolio(portfolioId: string): Promise<ReportJob[]>;
  nextPendingReport(): Promise<ReportJob | undefined>;
  markReportRunning(reportId: string, updatedAt: Date): Promise<ReportJob | undefined>;
  markReportReady(
    reportId: string,
    fileKey: string,
    contentType: string,
    completedAt: Date
  ): Promise<ReportJob | undefined>;
  markReportFailed(
    reportId: string,
    failureCode: string,
    completedAt: Date
  ): Promise<ReportJob | undefined>;
}

export interface ReportStorage {
  put(file: StoredReportFile): Promise<StoredReportFile>;
  get(fileKey: string): Promise<StoredReportFile | undefined>;
}

export interface AlertRepository {
  createAlert(alert: AlertRule): Promise<AlertRule>;
  updateAlert(
    alertId: string,
    input: Partial<Pick<AlertRule, "title" | "severity" | "status" | "condition" | "updatedAt">>
  ): Promise<AlertRule | undefined>;
  findAlertById(alertId: string): Promise<AlertRule | undefined>;
  listAlertsByPortfolio(portfolioId: string): Promise<AlertRule[]>;
  listActiveAlertsByPortfolio(portfolioId: string): Promise<AlertRule[]>;
  markAlertTriggered(alertId: string, triggeredAt: Date): Promise<AlertRule | undefined>;
}

export interface NotificationRepository {
  createNotification(notification: NotificationRecord): Promise<NotificationRecord>;
  listNotifications(input: {
    userId: string;
    visiblePortfolioIds: string[];
  }): Promise<NotificationRecord[]>;
  markNotificationRead(
    notificationId: string,
    userId: string,
    visiblePortfolioIds: string[],
    readAt: Date
  ): Promise<NotificationRecord | undefined>;
}

export interface RealtimeRepository {
  saveRealtimeMessage(message: RealtimeMessage): Promise<RealtimeMessage>;
  listRealtimeMessages(): Promise<RealtimeMessage[]>;
}

export interface ApplicationEventPublisher {
  publish(topic: string, aggregateId: string, payload: Record<string, unknown>): Promise<void>;
}
