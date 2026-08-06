import { Request, Response } from "express";
import { ApiError, ok } from "../http";
import { AuthenticatedRequest } from "../request";
import {
  AuthorizeRealtimeSubscriptionUseCase,
  CreateAlertUseCase,
  DownloadReportUseCase,
  ListAlertsUseCase,
  ListNotificationsUseCase,
  ListReportsUseCase,
  MarkNotificationReadUseCase,
  RequestReportUseCase,
  UpdateAlertUseCase
} from "../../modules/reports-alerts/use-cases";
import { InMemoryRealtimeHub } from "../../04-infra/realtime/InMemoryRealtimeHub";
import {
  AlertCondition,
  AlertSeverity,
  AlertStatus,
  ReportFormat
} from "../../modules/reports-alerts/types";

export class ReportsAlertsController {
  constructor(
    private readonly requestReportUseCase: RequestReportUseCase,
    private readonly listReportsUseCase: ListReportsUseCase,
    private readonly downloadReportUseCase: DownloadReportUseCase,
    private readonly listAlertsUseCase: ListAlertsUseCase,
    private readonly createAlertUseCase: CreateAlertUseCase,
    private readonly updateAlertUseCase: UpdateAlertUseCase,
    private readonly listNotificationsUseCase: ListNotificationsUseCase,
    private readonly markNotificationReadUseCase: MarkNotificationReadUseCase,
    private readonly authorizeRealtimeSubscriptionUseCase: AuthorizeRealtimeSubscriptionUseCase,
    private readonly realtimeHub: InMemoryRealtimeHub
  ) {}

  requestReport = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const portfolioId = requireParam(request, "portfolioId");
    const report = await this.requestReportUseCase.execute(
      actor,
      portfolioId,
      request.body.format as ReportFormat
    );
    return response.status(202).json({
      data: serializeReport(report),
      meta: { status: report.status }
    });
  };

  listReports = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const portfolioId = requireParam(request, "portfolioId");
    const reports = await this.listReportsUseCase.execute(actor, portfolioId);
    return ok(response, { reports: reports.map(serializeReport) }, { count: reports.length });
  };

  downloadReport = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const reportId = requireParam(request, "reportId");
    const { report, file } = await this.downloadReportUseCase.execute(actor, reportId);
    response.setHeader("Content-Type", file.contentType);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${report.id}.${report.format}"`
    );
    response.setHeader("X-Report-File-Key", file.fileKey);
    return response.send(file.body);
  };

  listAlerts = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const portfolioId = requireParam(request, "portfolioId");
    const alerts = await this.listAlertsUseCase.execute(actor, portfolioId);
    return ok(response, { alerts: alerts.map(serializeAlert) }, { count: alerts.length });
  };

  createAlert = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const portfolioId = requireParam(request, "portfolioId");
    const alert = await this.createAlertUseCase.execute(actor, portfolioId, {
      title: request.body.title,
      severity: request.body.severity as AlertSeverity,
      condition: request.body.condition as AlertCondition | undefined
    });
    return response.status(201).json({ data: serializeAlert(alert) });
  };

  updateAlert = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const alertId = requireParam(request, "alertId");
    const alert = await this.updateAlertUseCase.execute(actor, alertId, {
      title: request.body.title,
      severity: request.body.severity as AlertSeverity | undefined,
      status: request.body.status as AlertStatus | undefined,
      condition: request.body.condition as AlertCondition | undefined
    });
    return ok(response, serializeAlert(alert));
  };

  listNotifications = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const notifications = await this.listNotificationsUseCase.execute(actor);
    return ok(
      response,
      { notifications: notifications.map(serializeNotification) },
      { count: notifications.length }
    );
  };

  markNotificationRead = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const notificationId = requireParam(request, "notificationId");
    const notification = await this.markNotificationReadUseCase.execute(actor, notificationId);
    return ok(response, serializeNotification(notification));
  };

  subscribeRealtime = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const portfolioId =
      typeof request.query.portfolioId === "string" ? request.query.portfolioId : undefined;
    await this.authorizeRealtimeSubscriptionUseCase.execute(actor, portfolioId);

    if (request.query.once === "true") {
      response.setHeader("Content-Type", "text/event-stream");
      response.setHeader("Cache-Control", "no-cache, no-transform");
      response.write("event: connected\n");
      response.write(`data: ${JSON.stringify({ actorId: actor.id, portfolioId })}\n\n`);
      return response.end();
    }

    this.realtimeHub.subscribe(actor, response, portfolioId);
    return undefined;
  };
}

function requireParam(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== "string") {
    throw new ApiError(400, "request.invalid_param", `Invalid ${name}`);
  }
  return value;
}

function serializeReport(report: Parameters<typeof serializeReportInner>[0]) {
  return serializeReportInner(report);
}

function serializeReportInner(report: {
  id: string;
  portfolioId: string;
  requestedBy: string;
  format: string;
  status: string;
  fileKey?: string;
  contentType?: string;
  failureCode?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}) {
  return {
    ...report,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    completedAt: report.completedAt?.toISOString()
  };
}

function serializeAlert(alert: {
  id: string;
  portfolioId: string;
  createdBy: string;
  title: string;
  severity: string;
  status: string;
  condition: AlertCondition;
  createdAt: Date;
  updatedAt: Date;
  lastTriggeredAt?: Date;
}) {
  return {
    ...alert,
    createdAt: alert.createdAt.toISOString(),
    updatedAt: alert.updatedAt.toISOString(),
    lastTriggeredAt: alert.lastTriggeredAt?.toISOString()
  };
}

function serializeNotification(notification: {
  id: string;
  portfolioId?: string;
  userId?: string;
  title: string;
  body: string;
  severity: string;
  status: string;
  sourceType: string;
  sourceId: string;
  createdAt: Date;
  readAt?: Date;
}) {
  return {
    ...notification,
    createdAt: notification.createdAt.toISOString(),
    readAt: notification.readAt?.toISOString()
  };
}
