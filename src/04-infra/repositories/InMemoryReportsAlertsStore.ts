import {
  AlertRepository,
  NotificationRepository,
  RealtimeRepository,
  ReportRepository,
  ReportStorage
} from "../../02-application/reports-alerts/ports";
import {
  AlertRule,
  NotificationRecord,
  RealtimeMessage,
  ReportJob,
  StoredReportFile
} from "../../01-domain/reports-alerts/types";

export class InMemoryReportsAlertsStore
  implements
    ReportRepository,
    ReportStorage,
    AlertRepository,
    NotificationRepository,
    RealtimeRepository
{
  readonly reports = new Map<string, ReportJob>();
  readonly reportFiles = new Map<string, StoredReportFile>();
  readonly alerts = new Map<string, AlertRule>();
  readonly notifications = new Map<string, NotificationRecord>();
  readonly notificationReadReceipts = new Map<string, Map<string, Date>>();
  readonly realtimeMessages: RealtimeMessage[] = [];

  async createReport(job: ReportJob): Promise<ReportJob> {
    this.reports.set(job.id, { ...job });
    return { ...job };
  }

  async findReportById(reportId: string): Promise<ReportJob | undefined> {
    const report = this.reports.get(reportId);
    return report ? { ...report } : undefined;
  }

  async listReportsByPortfolio(portfolioId: string): Promise<ReportJob[]> {
    return Array.from(this.reports.values())
      .filter((report) => report.portfolioId === portfolioId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((report) => ({ ...report }));
  }

  async nextPendingReport(): Promise<ReportJob | undefined> {
    const report = Array.from(this.reports.values())
      .filter((entry) => entry.status === "pending")
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())[0];
    return report ? { ...report } : undefined;
  }

  async markReportRunning(reportId: string, updatedAt: Date): Promise<ReportJob | undefined> {
    const report = this.reports.get(reportId);
    if (!report) {
      return undefined;
    }

    report.status = "running";
    report.updatedAt = updatedAt;
    return { ...report };
  }

  async markReportReady(
    reportId: string,
    fileKey: string,
    contentType: string,
    completedAt: Date
  ): Promise<ReportJob | undefined> {
    const report = this.reports.get(reportId);
    if (!report) {
      return undefined;
    }

    report.status = "ready";
    report.fileKey = fileKey;
    report.contentType = contentType;
    report.completedAt = completedAt;
    report.updatedAt = completedAt;
    delete report.failureCode;
    return { ...report };
  }

  async markReportFailed(
    reportId: string,
    failureCode: string,
    completedAt: Date
  ): Promise<ReportJob | undefined> {
    const report = this.reports.get(reportId);
    if (!report) {
      return undefined;
    }

    report.status = "failed";
    report.failureCode = failureCode;
    report.completedAt = completedAt;
    report.updatedAt = completedAt;
    return { ...report };
  }

  async put(file: StoredReportFile): Promise<StoredReportFile> {
    this.reportFiles.set(file.fileKey, { ...file, body: Buffer.from(file.body) });
    return { ...file, body: Buffer.from(file.body) };
  }

  async get(fileKey: string): Promise<StoredReportFile | undefined> {
    const file = this.reportFiles.get(fileKey);
    return file ? { ...file, body: Buffer.from(file.body) } : undefined;
  }

  async createAlert(alert: AlertRule): Promise<AlertRule> {
    this.alerts.set(alert.id, { ...alert, condition: { ...alert.condition } });
    return { ...alert, condition: { ...alert.condition } };
  }

  async updateAlert(
    alertId: string,
    input: Partial<Pick<AlertRule, "title" | "severity" | "status" | "condition" | "updatedAt">>
  ): Promise<AlertRule | undefined> {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      return undefined;
    }

    if (input.title !== undefined) {
      alert.title = input.title;
    }
    if (input.severity !== undefined) {
      alert.severity = input.severity;
    }
    if (input.status !== undefined) {
      alert.status = input.status;
    }
    if (input.condition !== undefined) {
      alert.condition = { ...input.condition };
    }
    if (input.updatedAt !== undefined) {
      alert.updatedAt = input.updatedAt;
    }
    return { ...alert, condition: { ...alert.condition } };
  }

  async findAlertById(alertId: string): Promise<AlertRule | undefined> {
    const alert = this.alerts.get(alertId);
    return alert ? { ...alert, condition: { ...alert.condition } } : undefined;
  }

  async listAlertsByPortfolio(portfolioId: string): Promise<AlertRule[]> {
    return Array.from(this.alerts.values())
      .filter((alert) => alert.portfolioId === portfolioId)
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .map((alert) => ({ ...alert, condition: { ...alert.condition } }));
  }

  async listActiveAlertsByPortfolio(portfolioId: string): Promise<AlertRule[]> {
    return (await this.listAlertsByPortfolio(portfolioId)).filter(
      (alert) => alert.status !== "disabled"
    );
  }

  async markAlertTriggered(alertId: string, triggeredAt: Date): Promise<AlertRule | undefined> {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      return undefined;
    }

    alert.lastTriggeredAt = triggeredAt;
    alert.status = "open";
    alert.updatedAt = triggeredAt;
    return { ...alert, condition: { ...alert.condition } };
  }

  async createNotification(notification: NotificationRecord): Promise<NotificationRecord> {
    this.notifications.set(notification.id, { ...notification });
    return { ...notification };
  }

  async listNotificationsByPortfolioIds(portfolioIds: string[]): Promise<NotificationRecord[]> {
    const visiblePortfolioIds = new Set(portfolioIds);
    return Array.from(this.notifications.values())
      .filter((notification) =>
        notification.portfolioId ? visiblePortfolioIds.has(notification.portfolioId) : false
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((notification) => ({ ...notification }));
  }

  async listNotifications(input: {
    userId: string;
    visiblePortfolioIds: string[];
  }): Promise<NotificationRecord[]> {
    const visiblePortfolioIds = new Set(input.visiblePortfolioIds);
    return Array.from(this.notifications.values())
      .filter((notification) => {
        if (notification.userId && notification.userId !== input.userId) {
          return false;
        }
        return !notification.portfolioId || visiblePortfolioIds.has(notification.portfolioId);
      })
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((notification) => this.withActorReadState(notification, input.userId));
  }

  async markNotificationRead(
    notificationId: string,
    userId: string,
    visiblePortfolioIds: string[],
    readAt: Date
  ): Promise<NotificationRecord | undefined> {
    const notification = this.notifications.get(notificationId);
    if (!notification || (notification.userId && notification.userId !== userId)) {
      return undefined;
    }

    if (notification.portfolioId && !new Set(visiblePortfolioIds).has(notification.portfolioId)) {
      return undefined;
    }

    if (notification.userId) {
      notification.status = "read";
      notification.readAt = readAt;
      return { ...notification };
    }

    let readReceipts = this.notificationReadReceipts.get(notificationId);
    if (!readReceipts) {
      readReceipts = new Map<string, Date>();
      this.notificationReadReceipts.set(notificationId, readReceipts);
    }
    readReceipts.set(userId, readAt);
    return this.withActorReadState(notification, userId);
  }

  async saveRealtimeMessage(message: RealtimeMessage): Promise<RealtimeMessage> {
    this.realtimeMessages.push({ ...message, payload: { ...message.payload } });
    return { ...message, payload: { ...message.payload } };
  }

  async listRealtimeMessages(): Promise<RealtimeMessage[]> {
    return this.realtimeMessages.map((message) => ({
      ...message,
      payload: { ...message.payload }
    }));
  }

  private withActorReadState(notification: NotificationRecord, userId: string): NotificationRecord {
    if (notification.userId) {
      return { ...notification };
    }

    const readAt = this.notificationReadReceipts.get(notification.id)?.get(userId);
    if (!readAt) {
      return { ...notification, status: "unread", readAt: undefined };
    }

    return { ...notification, status: "read", readAt };
  }
}
