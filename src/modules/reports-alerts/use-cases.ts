import { randomUUID } from "crypto";
import { Actor } from "../../01-domain/auth/actor";
import { ApplicationError } from "../../02-application/errors/application-error";
import {
  AccountRepository,
  PortfolioRepository
} from "../../02-application/ports/repositories";
import { assertPortfolioReadAccess, listVisiblePortfolioIds } from "./access";
import {
  AlertRepository,
  ApplicationEventPublisher,
  NotificationRepository,
  ReportRepository,
  ReportStorage
} from "./ports";
import { AlertCondition, AlertRule, ReportFormat, ReportJob } from "./types";

export class RequestReportUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly portfolios: PortfolioRepository,
    private readonly reports: ReportRepository,
    private readonly events: ApplicationEventPublisher,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(actor: Actor, portfolioId: string, format: ReportFormat): Promise<ReportJob> {
    await assertPortfolioReadAccess(actor, portfolioId, this.accounts, this.portfolios);
    const createdAt = this.now();
    const report = await this.reports.createReport({
      id: randomUUID(),
      portfolioId,
      requestedBy: actor.id,
      format,
      status: "pending",
      createdAt,
      updatedAt: createdAt
    });

    await this.events.publish("ReportRequested", portfolioId, {
      portfolioId,
      reportId: report.id,
      format,
      requestedBy: actor.id
    });

    return report;
  }
}

export class ListReportsUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly portfolios: PortfolioRepository,
    private readonly reports: ReportRepository
  ) {}

  async execute(actor: Actor, portfolioId: string): Promise<ReportJob[]> {
    await assertPortfolioReadAccess(actor, portfolioId, this.accounts, this.portfolios);
    return this.reports.listReportsByPortfolio(portfolioId);
  }
}

export class DownloadReportUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly portfolios: PortfolioRepository,
    private readonly reports: ReportRepository,
    private readonly storage: ReportStorage
  ) {}

  async execute(actor: Actor, reportId: string) {
    const report = await this.reports.findReportById(reportId);
    if (!report) {
      throw new ApplicationError("not_found", "report.not_found", "Report not found");
    }
    await assertPortfolioReadAccess(actor, report.portfolioId, this.accounts, this.portfolios);

    if (report.status !== "ready" || !report.fileKey) {
      throw new ApplicationError("invalid", "report.not_ready", "Report is not ready");
    }

    const file = await this.storage.get(report.fileKey);
    if (!file) {
      throw new ApplicationError("unavailable", "report.file_unavailable", "Report file unavailable");
    }

    return { report, file };
  }
}

export class ListAlertsUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly portfolios: PortfolioRepository,
    private readonly alerts: AlertRepository
  ) {}

  async execute(actor: Actor, portfolioId: string): Promise<AlertRule[]> {
    await assertPortfolioReadAccess(actor, portfolioId, this.accounts, this.portfolios);
    return this.alerts.listAlertsByPortfolio(portfolioId);
  }
}

export class CreateAlertUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly portfolios: PortfolioRepository,
    private readonly alerts: AlertRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    actor: Actor,
    portfolioId: string,
    input: {
      title: string;
      severity: AlertRule["severity"];
      condition?: AlertCondition;
    }
  ): Promise<AlertRule> {
    await assertPortfolioReadAccess(actor, portfolioId, this.accounts, this.portfolios);
    const createdAt = this.now();
    return this.alerts.createAlert({
      id: randomUUID(),
      portfolioId,
      createdBy: actor.id,
      title: input.title.trim(),
      severity: input.severity,
      status: "monitoring",
      condition: input.condition ?? { eventType: "analytics.updated" },
      createdAt,
      updatedAt: createdAt
    });
  }
}

export class UpdateAlertUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly portfolios: PortfolioRepository,
    private readonly alerts: AlertRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    actor: Actor,
    alertId: string,
    input: Partial<Pick<AlertRule, "title" | "severity" | "status" | "condition">>
  ): Promise<AlertRule> {
    const alert = await this.alerts.findAlertById(alertId);
    if (!alert) {
      throw new ApplicationError("not_found", "alert.not_found", "Alert not found");
    }
    await assertPortfolioReadAccess(actor, alert.portfolioId, this.accounts, this.portfolios);

    const updated = await this.alerts.updateAlert(alertId, {
      ...input,
      title: input.title?.trim(),
      updatedAt: this.now()
    });
    if (!updated) {
      throw new ApplicationError("not_found", "alert.not_found", "Alert not found");
    }
    return updated;
  }
}

export class ListNotificationsUseCase {
  constructor(
    private readonly portfolios: PortfolioRepository,
    private readonly notifications: NotificationRepository
  ) {}

  async execute(actor: Actor) {
    return this.notifications.listNotifications({
      userId: actor.id,
      visiblePortfolioIds: await listVisiblePortfolioIds(actor, this.portfolios)
    });
  }
}

export class MarkNotificationReadUseCase {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(actor: Actor, notificationId: string) {
    const notification = await this.notifications.markNotificationRead(
      notificationId,
      actor.id,
      this.now()
    );
    if (!notification) {
      throw new ApplicationError(
        "not_found",
        "notification.not_found",
        "Notification not found"
      );
    }
    return notification;
  }
}

export class AuthorizeRealtimeSubscriptionUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly portfolios: PortfolioRepository
  ) {}

  async execute(actor: Actor, portfolioId?: string): Promise<{ portfolioId?: string }> {
    if (portfolioId) {
      await assertPortfolioReadAccess(actor, portfolioId, this.accounts, this.portfolios);
    }
    return { portfolioId };
  }
}
