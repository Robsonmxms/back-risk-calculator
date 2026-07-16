import { randomUUID } from "crypto";
import { PortfolioRepository } from "../../02-application/ports/repositories";
import { Logger } from "../../03-adapters/observability/Logger";
import { Metrics } from "../../03-adapters/observability/Metrics";
import {
  AlertRepository,
  ApplicationEventPublisher,
  NotificationRepository,
  ReportRepository,
  ReportStorage
} from "./ports";
import { AlertRule, ReportJob } from "./types";

export class ReportGenerationWorker {
  constructor(
    private readonly reports: ReportRepository,
    private readonly storage: ReportStorage,
    private readonly notifications: NotificationRepository,
    private readonly events: ApplicationEventPublisher,
    private readonly portfolios: PortfolioRepository,
    private readonly logger: Logger,
    private readonly metrics: Metrics,
    private readonly now: () => Date = () => new Date()
  ) {}

  async processNext(): Promise<ReportJob | undefined> {
    const report = await this.reports.nextPendingReport();
    if (!report) {
      return undefined;
    }

    return this.processReport(report);
  }

  async processReport(report: ReportJob): Promise<ReportJob> {
    const startedAt = this.now();
    await this.reports.markReportRunning(report.id, startedAt);

    try {
      const file = await this.buildReportFile(report);
      await this.storage.put(file);
      const ready = await this.reports.markReportReady(
        report.id,
        file.fileKey,
        file.contentType,
        this.now()
      );
      const completed = ready ?? report;

      await this.notifications.createNotification({
        id: randomUUID(),
        portfolioId: report.portfolioId,
        userId: report.requestedBy,
        title: "Relatório pronto",
        body: `O relatório ${report.format.toUpperCase()} foi gerado e está disponível para download.`,
        severity: "info",
        status: "unread",
        sourceType: "report",
        sourceId: report.id,
        createdAt: this.now()
      });
      await this.events.publish("ReportGenerated", report.portfolioId, {
        portfolioId: report.portfolioId,
        reportId: report.id,
        format: report.format,
        fileKey: file.fileKey
      });
      await this.events.publish("NotificationSent", report.portfolioId, {
        portfolioId: report.portfolioId,
        reportId: report.id,
        sourceType: "report"
      });
      this.metrics.increment("report.generation.success");
      this.metrics.increment(
        "report.generation.duration_ms",
        this.now().getTime() - startedAt.getTime()
      );
      this.logger.info("report.generation.succeeded", {
        reportId: report.id,
        portfolioId: report.portfolioId,
        format: report.format
      });
      return completed;
    } catch (error) {
      const failureCode = error instanceof Error ? error.message : "report.generation_failed";
      const failed =
        (await this.reports.markReportFailed(report.id, failureCode, this.now())) ?? report;
      await this.notifications.createNotification({
        id: randomUUID(),
        portfolioId: report.portfolioId,
        userId: report.requestedBy,
        title: "Falha ao gerar relatório",
        body: "O relatório não foi concluído. A solicitação pode ser reenfileirada.",
        severity: "high",
        status: "unread",
        sourceType: "report",
        sourceId: report.id,
        createdAt: this.now()
      });
      await this.events.publish("ReportFailed", report.portfolioId, {
        portfolioId: report.portfolioId,
        reportId: report.id,
        failureCode
      });
      this.metrics.increment("report.generation.failure");
      this.metrics.increment(
        "report.generation.duration_ms",
        this.now().getTime() - startedAt.getTime()
      );
      this.logger.warn("report.generation.failed", {
        reportId: report.id,
        portfolioId: report.portfolioId,
        failureCode
      });
      return failed;
    }
  }

  private async buildReportFile(report: ReportJob) {
    const positions = await this.portfolios.listPortfolioPositions(report.portfolioId);
    const generatedAt = this.now().toISOString();
    const fileKey = `reports/${report.portfolioId}/${report.id}.${report.format}`;

    if (report.format === "csv") {
      const header = "symbol,name,quantity,currency,total_cost_basis";
      const rows = positions.map((position) =>
        [
          position.assetSymbol,
          JSON.stringify(position.assetName),
          position.quantity,
          position.currency,
          position.totalCostBasis
        ].join(",")
      );
      return {
        fileKey,
        contentType: "text/csv",
        body: Buffer.from([header, ...rows].join("\n"), "utf8")
      };
    }

    const lines = [
      "%PDF-1.4",
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
      "2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj",
      "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj",
      `4 0 obj << /Length 84 >> stream\nBT /F1 12 Tf 72 720 Td (Risk report ${report.portfolioId} ${generatedAt}) Tj ET\nendstream endobj`,
      "xref",
      "0 5",
      "0000000000 65535 f ",
      "trailer << /Root 1 0 R >>",
      "%%EOF"
    ];
    return {
      fileKey,
      contentType: "application/pdf",
      body: Buffer.from(lines.join("\n"), "utf8")
    };
  }
}

export class AlertEvaluationWorker {
  constructor(
    private readonly alerts: AlertRepository,
    private readonly notifications: NotificationRepository,
    private readonly events: ApplicationEventPublisher,
    private readonly metrics: Metrics,
    private readonly now: () => Date = () => new Date()
  ) {}

  async evaluatePortfolioEvent(
    portfolioId: string,
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    if (!["analytics.updated", "market_data.updated", "report.generated"].includes(eventType)) {
      return;
    }

    const activeAlerts = await this.alerts.listActiveAlertsByPortfolio(portfolioId);
    for (const alert of activeAlerts) {
      if (!this.matches(alert, eventType, payload)) {
        continue;
      }

      const triggeredAt = this.now();
      await this.alerts.markAlertTriggered(alert.id, triggeredAt);
      const notification = await this.notifications.createNotification({
        id: randomUUID(),
        portfolioId,
        title: alert.title,
        body: this.notificationBody(alert, eventType),
        severity: alert.severity,
        status: "unread",
        sourceType: "alert",
        sourceId: alert.id,
        createdAt: triggeredAt
      });
      await this.events.publish("AlertTriggered", portfolioId, {
        portfolioId,
        alertId: alert.id,
        severity: alert.severity,
        notificationId: notification.id
      });
      await this.events.publish("NotificationSent", portfolioId, {
        portfolioId,
        notificationId: notification.id,
        sourceType: "alert"
      });
      this.metrics.increment("alert.triggered");
    }
  }

  private matches(alert: AlertRule, eventType: string, payload: Record<string, unknown>): boolean {
    if (alert.condition.eventType === eventType) {
      return true;
    }

    if (alert.condition.eventType !== "metric_threshold" || eventType !== "analytics.updated") {
      return false;
    }

    const metricKey = alert.condition.metricKey;
    if (!metricKey) {
      return false;
    }
    const metrics = payload.metrics as Record<string, { value?: number }> | undefined;
    const value = metrics?.[metricKey]?.value;
    if (typeof value !== "number") {
      return false;
    }

    const threshold = alert.condition.threshold ?? 0;
    return alert.condition.operator === "lte" ? value <= threshold : value >= threshold;
  }

  private notificationBody(alert: AlertRule, eventType: string): string {
    if (alert.condition.eventType === "metric_threshold") {
      return "Uma métrica monitorada cruzou o limite configurado pelo alerta.";
    }
    return `Evento ${eventType} recebido para um alerta em monitoramento.`;
  }
}
