import { Actor } from "../../../01-domain/auth/actor";
import {
  AuditEvent,
  AuditResourceType,
  AuditSeverity,
  SupervisionReview
} from "../../../01-domain/compliance/audit";
import { ReportPackage, ReportPackageStatus } from "../../../01-domain/delivery/report-package";
import { PortfolioSummary } from "../../../01-domain/portfolios/portfolio";
import { PermissionService } from "../../auth/permission-service";
import { ApplicationError } from "../../errors/application-error";
import { LoggerPort, MetricsPort } from "../../ports/observability";
import {
  AdvisoryTeamRepository,
  AuditRepository,
  ClientRepository,
  ReportPackageRepository,
  PortfolioRepository
} from "../../ports/repositories";
import { DataQualityIssue } from "../../../01-domain/analytics/types";
import { NotificationRepository, ReportRepository } from "../../reports-alerts/ports";
import {
  NotificationRecord,
  NotificationStatus,
  ReportJob,
  ReportStatus
} from "../../../01-domain/reports-alerts/types";
import {
  ApprovalLatencyPoint,
  ClientPackageReadinessPoint,
  ComplianceChartBundle,
  ComplianceChartsQuery,
  ComplianceChartsResponse,
  ComplianceDeliveryChartRange,
  ComplianceDeliveryDataQualityStatus,
  DeliveryChartBundle,
  DeliveryChartsQuery,
  DeliveryChartsResponse,
  DeliveryOutcomeTimelinePoint,
  FailureReasonBreakdownPoint,
  NotificationReadStatusPoint,
  ReportLifecycleFunnelPoint
} from "./compliance-delivery-chart-types";

interface ChartRangeWindow {
  from?: Date;
}

interface DeliveryClientSource {
  id: string;
  name: string;
  householdId?: string;
  advisorUserId?: string;
  portfolios: PortfolioSummary[];
}

interface DeliveryChartSource {
  officeId: string;
  clients: DeliveryClientSource[];
  portfolios: PortfolioSummary[];
  packages: ReportPackage[];
  reports: ReportJob[];
  notifications: NotificationRecord[];
  deliveryAuditEvents: AuditEvent[];
  issues: DataQualityIssue[];
}

export class GetComplianceChartsUseCase {
  constructor(
    private readonly audits: AuditRepository,
    private readonly permissions: PermissionService,
    private readonly logger: LoggerPort,
    private readonly metrics: MetricsPort,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    actor: Actor,
    officeId: string,
    query: ComplianceChartsQuery
  ): Promise<ComplianceChartsResponse> {
    const startedAt = this.now().getTime();
    await this.permissions.assertPermission(actor, officeId, "audit.read");

    const window = rangeWindow(query.range, this.now());
    const auditPage = await this.audits.listAuditEvents(officeId, {
      page: 1,
      pageSize: 100,
      from: window.from?.toISOString(),
      action: query.action,
      resourceType: query.resourceType,
      severity: query.severity
    });
    const events = auditPage.events.filter((event) => withinWindow(event.createdAt, window));
    const reviews = (
      await this.audits.listSupervisionReviews(officeId, {
        status: query.status,
        severity: query.severity,
        assignedToUserId: query.assigneeUserId
      })
    ).filter((review) => withinWindow(review.createdAt, window));

    const issues: DataQualityIssue[] = [];
    if (auditPage.total > auditPage.events.length) {
      issues.push({
        code: "compliance_charts.audit_events_truncated",
        severity: "warning",
        message: "A agregação de auditoria foi limitada aos primeiros 100 eventos autorizados."
      });
    }

    const redactedAuditMetadataFields = countRedactedAuditMetadataFields(events);
    if (redactedAuditMetadataFields > 0) {
      issues.push({
        code: "compliance_charts.audit_metadata_redacted",
        severity: "info",
        message: "Campos sensíveis foram omitidos dos metadados de auditoria usados nos gráficos."
      });
    }

    const data: ComplianceChartBundle = {
      officeId,
      range: query.range,
      filters: {
        resourceType: query.resourceType,
        action: query.action,
        severity: query.severity,
        status: query.status,
        assigneeUserId: query.assigneeUserId
      },
      charts: {
        auditEventTimeline: buildAuditEventTimeline(events),
        auditActionBreakdown: buildAuditActionBreakdown(events),
        reviewStatusFunnel: buildReviewStatusFunnel(reviews),
        reviewAging: buildReviewAging(reviews, this.now()),
        permissionActivity: buildPermissionActivity(events),
        exceptionHeatmap: buildExceptionHeatmap(events)
      },
      dataQuality: {
        status: dataQualityStatus(issues, events.length + reviews.length),
        issues,
        sourceCounts: {
          auditEvents: events.length,
          supervisionReviews: reviews.length,
          redactedAuditMetadataFields
        }
      }
    };

    const calculationDurationMs = this.now().getTime() - startedAt;
    this.metrics.increment("compliance.charts.request");
    if (data.dataQuality.status !== "complete") {
      this.metrics.increment("compliance.charts.partial");
    }
    this.logger.info("compliance.charts.generated", {
      actorId: actor.id,
      officeId,
      range: query.range,
      resourceType: query.resourceType,
      action: query.action,
      severity: query.severity,
      status: query.status,
      assigneeUserId: query.assigneeUserId,
      auditEventCount: events.length,
      supervisionReviewCount: reviews.length,
      latencyMs: calculationDurationMs
    });

    return {
      data,
      meta: {
        generatedAt: this.now().toISOString(),
        calculationDurationMs
      }
    };
  }
}

export class GetDeliveryChartsUseCase {
  constructor(
    private readonly clients: ClientRepository,
    private readonly portfolios: PortfolioRepository,
    private readonly advisory: AdvisoryTeamRepository,
    private readonly packages: ReportPackageRepository,
    private readonly reports: ReportRepository,
    private readonly notifications: NotificationRepository,
    private readonly audits: AuditRepository,
    private readonly permissions: PermissionService,
    private readonly logger: LoggerPort,
    private readonly metrics: MetricsPort,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    actor: Actor,
    officeId: string,
    query: DeliveryChartsQuery
  ): Promise<DeliveryChartsResponse> {
    const startedAt = this.now().getTime();
    const source = await this.buildSource(actor, officeId, query);
    const data = buildDeliveryChartBundle(source, query);
    const calculationDurationMs = this.now().getTime() - startedAt;

    this.metrics.increment("delivery.charts.request");
    if (data.dataQuality.status !== "complete") {
      this.metrics.increment("delivery.charts.partial");
    }
    this.logger.info("delivery.charts.generated", {
      actorId: actor.id,
      officeId,
      range: query.range,
      packageStatus: query.packageStatus,
      deliveryStatus: query.deliveryStatus,
      channel: query.channel,
      clientId: query.clientId,
      householdId: query.householdId,
      advisorUserId: query.advisorUserId,
      clientCount: source.clients.length,
      packageCount: source.packages.length,
      notificationCount: source.notifications.length,
      latencyMs: calculationDurationMs
    });

    return {
      data,
      meta: {
        generatedAt: this.now().toISOString(),
        calculationDurationMs
      }
    };
  }

  private async buildSource(
    actor: Actor,
    officeId: string,
    query: DeliveryChartsQuery
  ): Promise<DeliveryChartSource> {
    const evaluation = await this.permissions.evaluate(actor, officeId);
    if (evaluation.role === "client") {
      this.metrics.increment("delivery.charts.denied");
      throw new ApplicationError(
        "forbidden",
        "auth.delivery_chart_scope_denied",
        "Delivery chart scope denied"
      );
    }
    if (
      !evaluation.permissions.includes("reports.request") &&
      !evaluation.permissions.includes("reports.approve")
    ) {
      this.metrics.increment("delivery.charts.denied");
      throw new ApplicationError(
        "forbidden",
        "auth.permission_denied",
        "Report permission is required"
      );
    }

    const window = rangeWindow(query.range, this.now());
    const allClientSummaries = await this.clients.listClients(officeId, {});
    const visibleClientIds =
      evaluation.role === "office_admin"
        ? undefined
        : await this.visibleAssignedClientIds(actor, officeId, allClientSummaries);

    const scopedClientSummaries = allClientSummaries
      .filter((client) => !visibleClientIds || visibleClientIds.has(client.id))
      .filter((client) => !query.clientId || client.id === query.clientId)
      .filter((client) => !query.householdId || client.householdId === query.householdId)
      .filter((client) => !query.advisorUserId || client.advisorUserId === query.advisorUserId);

    const clientDetails = (
      await Promise.all(
        scopedClientSummaries.map((client) => this.clients.findClientById(client.id))
      )
    ).filter((client): client is NonNullable<typeof client> => Boolean(client));
    const sourceClients: DeliveryClientSource[] = clientDetails.map((client) => ({
      id: client.id,
      name: client.name,
      householdId: client.householdId,
      advisorUserId: client.advisorUserId,
      portfolios: client.portfolios
    }));
    const sourcePortfolios = sourceClients.flatMap((client) => client.portfolios);
    const portfolioIds = new Set(sourcePortfolios.map((portfolio) => portfolio.id));

    const packages = (
      await Promise.all(
        sourceClients.map((client) => this.packages.listReportPackagesByClient(client.id))
      )
    )
      .flat()
      .filter((reportPackage) => withinWindow(reportPackage.updatedAt, window))
      .filter(
        (reportPackage) => !query.packageStatus || reportPackage.status === query.packageStatus
      )
      .filter(
        (reportPackage) =>
          !isReportPackageStatus(query.deliveryStatus) ||
          reportPackage.status === query.deliveryStatus
      );

    const reports = (
      await Promise.all(
        sourcePortfolios.map((portfolio) => this.reports.listReportsByPortfolio(portfolio.id))
      )
    )
      .flat()
      .filter((report) => withinWindow(report.updatedAt, window))
      .filter(
        (report) => !isReportStatus(query.deliveryStatus) || report.status === query.deliveryStatus
      );

    const notifications = (
      await this.notifications.listNotificationsByPortfolioIds([...portfolioIds])
    )
      .filter((notification) => withinWindow(notification.createdAt, window))
      .filter(
        (notification) =>
          !isNotificationStatus(query.deliveryStatus) ||
          notification.status === query.deliveryStatus
      );

    const deliveryAuditEvents = await this.loadDeliveryAuditEvents(officeId, window, query);
    const issues: DataQualityIssue[] = [];
    if (
      deliveryAuditEvents.some((event) => event.metadata.failureCode && !event.metadata.channel)
    ) {
      issues.push({
        code: "delivery_charts.failure_channel_missing",
        severity: "info",
        message: "Alguns eventos de falha de entrega não informam canal."
      });
    }
    if (packages.length > 0 && notifications.length === 0) {
      issues.push({
        code: "delivery_charts.notifications_unavailable",
        severity: "warning",
        message: "Pacotes existem, mas não há notificações relacionadas dentro do escopo."
      });
    }

    return {
      officeId,
      clients: sourceClients,
      portfolios: sourcePortfolios,
      packages,
      reports,
      notifications,
      deliveryAuditEvents,
      issues
    };
  }

  private async visibleAssignedClientIds(
    actor: Actor,
    officeId: string,
    clients: Array<{ id: string; householdId?: string }>
  ): Promise<Set<string>> {
    const assignments = (await this.advisory.listAssignmentsForUser(actor.id, officeId)).filter(
      (assignment) =>
        !assignment.revokedAt &&
        (assignment.permissions.includes("reports.request") ||
          assignment.permissions.includes("reports.approve") ||
          assignment.permissions.includes("client.read"))
    );
    const clientIds = new Set<string>();
    const portfolios = await this.portfolios.listVisiblePortfolios(
      actor.id,
      actor.role === "admin"
    );

    for (const assignment of assignments) {
      if (assignment.resourceType === "client") {
        clientIds.add(assignment.resourceId);
      }
      if (assignment.resourceType === "household") {
        for (const client of clients) {
          if (client.householdId === assignment.resourceId) {
            clientIds.add(client.id);
          }
        }
      }
      if (assignment.resourceType === "portfolio") {
        const portfolio = portfolios.find((entry) => entry.id === assignment.resourceId);
        if (portfolio?.clientId) {
          clientIds.add(portfolio.clientId);
        }
      }
      if (assignment.resourceType === "account") {
        for (const portfolio of portfolios) {
          if (portfolio.accountId === assignment.resourceId && portfolio.clientId) {
            clientIds.add(portfolio.clientId);
          }
        }
      }
    }

    return clientIds;
  }

  private async loadDeliveryAuditEvents(
    officeId: string,
    window: ChartRangeWindow,
    query: DeliveryChartsQuery
  ): Promise<AuditEvent[]> {
    const resourceTypes: AuditResourceType[] = ["delivery", "report", "notification"];
    const pages = await Promise.all(
      resourceTypes.map((resourceType) =>
        this.audits.listAuditEvents(officeId, {
          page: 1,
          pageSize: 100,
          from: window.from?.toISOString(),
          resourceType
        })
      )
    );
    return pages
      .flatMap((page) => page.events)
      .filter((event) => withinWindow(event.createdAt, window))
      .filter((event) => !query.channel || String(event.metadata.channel ?? "") === query.channel)
      .filter(
        (event) => !isAuditOutcome(query.deliveryStatus) || event.outcome === query.deliveryStatus
      )
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }
}

function buildAuditEventTimeline(events: AuditEvent[]) {
  const buckets = new Map<
    string,
    {
      date: string;
      success: number;
      failure: number;
      info: number;
      warning: number;
      critical: number;
      total: number;
      eventIds: Set<string>;
      clientIds: Set<string>;
      portfolioIds: Set<string>;
    }
  >();

  for (const event of events) {
    const date = dayKey(event.createdAt);
    const bucket = getOrSet(buckets, date, () => ({
      date,
      success: 0,
      failure: 0,
      info: 0,
      warning: 0,
      critical: 0,
      total: 0,
      eventIds: new Set<string>(),
      clientIds: new Set<string>(),
      portfolioIds: new Set<string>()
    }));
    bucket[event.outcome] += 1;
    bucket[event.severity] += 1;
    bucket.total += 1;
    bucket.eventIds.add(event.id);
    if (event.clientId) {
      bucket.clientIds.add(event.clientId);
    }
    if (event.portfolioId) {
      bucket.portfolioIds.add(event.portfolioId);
    }
  }

  return [...buckets.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((bucket) => ({
      date: bucket.date,
      success: bucket.success,
      failure: bucket.failure,
      info: bucket.info,
      warning: bucket.warning,
      critical: bucket.critical,
      total: bucket.total,
      eventIds: [...bucket.eventIds],
      clientIds: [...bucket.clientIds],
      portfolioIds: [...bucket.portfolioIds]
    }));
}

function buildAuditActionBreakdown(events: AuditEvent[]) {
  const buckets = new Map<
    string,
    {
      action: string;
      resourceType: AuditResourceType;
      outcome: "success" | "failure";
      severity: AuditSeverity;
      count: number;
      eventIds: Set<string>;
    }
  >();

  for (const event of events) {
    const key = [event.action, event.resourceType, event.outcome, event.severity].join("|");
    const bucket = getOrSet(buckets, key, () => ({
      action: event.action,
      resourceType: event.resourceType,
      outcome: event.outcome,
      severity: event.severity,
      count: 0,
      eventIds: new Set<string>()
    }));
    bucket.count += 1;
    bucket.eventIds.add(event.id);
  }

  return [...buckets.values()]
    .sort((left, right) => right.count - left.count || left.action.localeCompare(right.action))
    .map((bucket) => ({
      ...bucket,
      eventIds: [...bucket.eventIds]
    }));
}

function buildReviewStatusFunnel(reviews: SupervisionReview[]) {
  const buckets = new Map<
    string,
    {
      status: SupervisionReview["status"];
      count: number;
      reviewIds: Set<string>;
      auditEventIds: Set<string>;
    }
  >();

  for (const review of reviews) {
    const bucket = getOrSet(buckets, review.status, () => ({
      status: review.status,
      count: 0,
      reviewIds: new Set<string>(),
      auditEventIds: new Set<string>()
    }));
    bucket.count += 1;
    bucket.reviewIds.add(review.id);
    bucket.auditEventIds.add(review.auditEventId);
  }

  return [...buckets.values()].map((bucket) => ({
    status: bucket.status,
    count: bucket.count,
    reviewIds: [...bucket.reviewIds],
    auditEventIds: [...bucket.auditEventIds]
  }));
}

function buildReviewAging(reviews: SupervisionReview[], now: Date) {
  const activeReviews = reviews.filter((review) => review.status !== "resolved");
  const buckets = new Map<
    string,
    {
      bucket: "0-1d" | "2-3d" | "4-7d" | "8-14d" | "15d+";
      count: number;
      reviewIds: Set<string>;
      auditEventIds: Set<string>;
    }
  >();

  for (const review of activeReviews) {
    const ageDays = Math.max(
      0,
      Math.floor((now.getTime() - review.createdAt.getTime()) / 86_400_000)
    );
    const label =
      ageDays <= 1
        ? "0-1d"
        : ageDays <= 3
          ? "2-3d"
          : ageDays <= 7
            ? "4-7d"
            : ageDays <= 14
              ? "8-14d"
              : "15d+";
    const bucket = getOrSet(buckets, label, () => ({
      bucket: label,
      count: 0,
      reviewIds: new Set<string>(),
      auditEventIds: new Set<string>()
    }));
    bucket.count += 1;
    bucket.reviewIds.add(review.id);
    bucket.auditEventIds.add(review.auditEventId);
  }

  const order = ["0-1d", "2-3d", "4-7d", "8-14d", "15d+"];
  return [...buckets.values()]
    .sort((left, right) => order.indexOf(left.bucket) - order.indexOf(right.bucket))
    .map((bucket) => ({
      bucket: bucket.bucket,
      count: bucket.count,
      reviewIds: [...bucket.reviewIds],
      auditEventIds: [...bucket.auditEventIds]
    }));
}

function buildPermissionActivity(events: AuditEvent[]) {
  const permissionEvents = events.filter((event) => event.resourceType === "permission");
  const buckets = new Map<
    string,
    {
      date: string;
      created: number;
      revoked: number;
      roleChanges: number;
      total: number;
      eventIds: Set<string>;
    }
  >();

  for (const event of permissionEvents) {
    const date = dayKey(event.createdAt);
    const bucket = getOrSet(buckets, date, () => ({
      date,
      created: 0,
      revoked: 0,
      roleChanges: 0,
      total: 0,
      eventIds: new Set<string>()
    }));
    if (event.action.includes("revoked")) {
      bucket.revoked += 1;
    } else if (event.action.includes("role")) {
      bucket.roleChanges += 1;
    } else {
      bucket.created += 1;
    }
    bucket.total += 1;
    bucket.eventIds.add(event.id);
  }

  return [...buckets.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((bucket) => ({
      date: bucket.date,
      created: bucket.created,
      revoked: bucket.revoked,
      roleChanges: bucket.roleChanges,
      total: bucket.total,
      eventIds: [...bucket.eventIds]
    }));
}

function buildExceptionHeatmap(events: AuditEvent[]) {
  const exceptions = events.filter(
    (event) => event.outcome === "failure" || event.reviewRequired || event.severity !== "info"
  );
  const buckets = new Map<
    string,
    {
      date: string;
      severity: AuditSeverity;
      count: number;
      eventIds: Set<string>;
    }
  >();

  for (const event of exceptions) {
    const date = dayKey(event.createdAt);
    const key = `${date}|${event.severity}`;
    const bucket = getOrSet(buckets, key, () => ({
      date,
      severity: event.severity,
      count: 0,
      eventIds: new Set<string>()
    }));
    bucket.count += 1;
    bucket.eventIds.add(event.id);
  }

  return [...buckets.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((bucket) => ({
      date: bucket.date,
      severity: bucket.severity,
      count: bucket.count,
      eventIds: [...bucket.eventIds]
    }));
}

function buildDeliveryChartBundle(
  source: DeliveryChartSource,
  query: DeliveryChartsQuery
): DeliveryChartBundle {
  const sourceCounts = {
    clients: source.clients.length,
    portfolios: source.portfolios.length,
    reportPackages: source.packages.length,
    reports: source.reports.length,
    notifications: source.notifications.length,
    deliveryAuditEvents: source.deliveryAuditEvents.length
  };
  const totalSources = Object.values(sourceCounts).reduce((sum, value) => sum + value, 0);

  return {
    officeId: source.officeId,
    range: query.range,
    filters: {
      packageStatus: query.packageStatus,
      deliveryStatus: query.deliveryStatus,
      channel: query.channel,
      clientId: query.clientId,
      householdId: query.householdId,
      advisorUserId: query.advisorUserId
    },
    charts: {
      reportLifecycleFunnel: buildReportLifecycleFunnel(source.packages),
      approvalLatency: buildApprovalLatency(source.packages),
      deliveryOutcomeTimeline: buildDeliveryOutcomeTimeline(
        source.packages,
        source.deliveryAuditEvents
      ),
      failureReasonBreakdown: buildFailureReasonBreakdown(source.deliveryAuditEvents),
      notificationReadStatus: buildNotificationReadStatus(source.notifications),
      clientPackageReadiness: buildClientPackageReadiness(source)
    },
    dataQuality: {
      status: dataQualityStatus(source.issues, totalSources),
      issues: source.issues,
      sourceCounts
    }
  };
}

function buildReportLifecycleFunnel(packages: ReportPackage[]): ReportLifecycleFunnelPoint[] {
  const buckets = new Map<
    ReportPackageStatus,
    {
      status: ReportPackageStatus;
      count: number;
      reportPackageIds: Set<string>;
      clientIds: Set<string>;
    }
  >();

  for (const reportPackage of packages) {
    const bucket = getOrSet(buckets, reportPackage.status, () => ({
      status: reportPackage.status,
      count: 0,
      reportPackageIds: new Set<string>(),
      clientIds: new Set<string>()
    }));
    bucket.count += 1;
    bucket.reportPackageIds.add(reportPackage.id);
    bucket.clientIds.add(reportPackage.clientId);
  }

  return [...buckets.values()].map((bucket) => ({
    status: bucket.status,
    count: bucket.count,
    reportPackageIds: [...bucket.reportPackageIds],
    clientIds: [...bucket.clientIds]
  }));
}

function buildApprovalLatency(packages: ReportPackage[]): ApprovalLatencyPoint[] {
  const approvedPackages = packages.filter((reportPackage) => reportPackage.approvedAt);
  const buckets = new Map<
    ApprovalLatencyPoint["bucket"],
    {
      bucket: ApprovalLatencyPoint["bucket"];
      count: number;
      totalHours: number;
      reportPackageIds: Set<string>;
    }
  >();

  for (const reportPackage of approvedPackages) {
    const approvedAt = reportPackage.approvedAt;
    if (!approvedAt) {
      continue;
    }
    const hours = Math.max(
      0,
      (approvedAt.getTime() - reportPackage.createdAt.getTime()) / 3_600_000
    );
    const label = hours <= 4 ? "0-4h" : hours <= 24 ? "4-24h" : hours <= 72 ? "1-3d" : "3d+";
    const bucket = getOrSet(buckets, label, () => ({
      bucket: label,
      count: 0,
      totalHours: 0,
      reportPackageIds: new Set<string>()
    }));
    bucket.count += 1;
    bucket.totalHours += hours;
    bucket.reportPackageIds.add(reportPackage.id);
  }

  const order = ["0-4h", "4-24h", "1-3d", "3d+"];
  return [...buckets.values()]
    .sort((left, right) => order.indexOf(left.bucket) - order.indexOf(right.bucket))
    .map((bucket) => ({
      bucket: bucket.bucket,
      count: bucket.count,
      averageHours: round(bucket.totalHours / Math.max(bucket.count, 1), 1),
      reportPackageIds: [...bucket.reportPackageIds]
    }));
}

function buildDeliveryOutcomeTimeline(
  packages: ReportPackage[],
  events: AuditEvent[]
): DeliveryOutcomeTimelinePoint[] {
  const buckets = new Map<
    string,
    {
      date: string;
      delivered: number;
      viewed: number;
      failed: number;
      revoked: number;
      total: number;
      reportPackageIds: Set<string>;
      eventIds: Set<string>;
    }
  >();

  for (const reportPackage of packages) {
    const statusDate =
      reportPackage.viewedAt ??
      reportPackage.revokedAt ??
      reportPackage.deliveredAt ??
      reportPackage.updatedAt;
    const date = dayKey(statusDate);
    const bucket = getOrSetDeliveryTimelineBucket(buckets, date);
    if (reportPackage.status === "viewed") {
      bucket.viewed += 1;
    } else if (reportPackage.status === "revoked") {
      bucket.revoked += 1;
    } else if (reportPackage.status === "delivered") {
      bucket.delivered += 1;
    }
    bucket.total += 1;
    bucket.reportPackageIds.add(reportPackage.id);
  }

  for (const event of events.filter((entry) => entry.outcome === "failure")) {
    const date = dayKey(event.createdAt);
    const bucket = getOrSetDeliveryTimelineBucket(buckets, date);
    bucket.failed += 1;
    bucket.total += 1;
    bucket.eventIds.add(event.id);
    if (event.resourceType === "delivery") {
      bucket.reportPackageIds.add(event.resourceId);
    }
  }

  return [...buckets.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((bucket) => ({
      date: bucket.date,
      delivered: bucket.delivered,
      viewed: bucket.viewed,
      failed: bucket.failed,
      revoked: bucket.revoked,
      total: bucket.total,
      reportPackageIds: [...bucket.reportPackageIds],
      eventIds: [...bucket.eventIds]
    }));
}

function buildFailureReasonBreakdown(events: AuditEvent[]): FailureReasonBreakdownPoint[] {
  const failedEvents = events.filter((event) => event.outcome === "failure");
  const buckets = new Map<
    string,
    {
      failureCode: string;
      channel?: string;
      count: number;
      eventIds: Set<string>;
      reportPackageIds: Set<string>;
    }
  >();

  for (const event of failedEvents) {
    const failureCode = String(event.metadata.failureCode ?? "unclassified_failure");
    const channel = typeof event.metadata.channel === "string" ? event.metadata.channel : undefined;
    const key = `${failureCode}|${channel ?? ""}`;
    const bucket = getOrSet(buckets, key, () => ({
      failureCode,
      channel,
      count: 0,
      eventIds: new Set<string>(),
      reportPackageIds: new Set<string>()
    }));
    bucket.count += 1;
    bucket.eventIds.add(event.id);
    if (event.resourceType === "delivery") {
      bucket.reportPackageIds.add(event.resourceId);
    }
  }

  return [...buckets.values()]
    .sort(
      (left, right) => right.count - left.count || left.failureCode.localeCompare(right.failureCode)
    )
    .map((bucket) => ({
      failureCode: bucket.failureCode,
      channel: bucket.channel,
      count: bucket.count,
      eventIds: [...bucket.eventIds],
      reportPackageIds: [...bucket.reportPackageIds]
    }));
}

function buildNotificationReadStatus(
  notifications: NotificationRecord[]
): NotificationReadStatusPoint[] {
  const buckets = new Map<
    NotificationStatus,
    {
      status: NotificationStatus;
      count: number;
      notificationIds: Set<string>;
    }
  >();

  for (const notification of notifications) {
    const bucket = getOrSet(buckets, notification.status, () => ({
      status: notification.status,
      count: 0,
      notificationIds: new Set<string>()
    }));
    bucket.count += 1;
    bucket.notificationIds.add(notification.id);
  }

  return [...buckets.values()].map((bucket) => ({
    status: bucket.status,
    count: bucket.count,
    notificationIds: [...bucket.notificationIds]
  }));
}

function buildClientPackageReadiness(source: DeliveryChartSource): ClientPackageReadinessPoint[] {
  return source.clients
    .map((client) => {
      const packages = source.packages.filter(
        (reportPackage) => reportPackage.clientId === client.id
      );
      const portfolioIds = new Set(client.portfolios.map((portfolio) => portfolio.id));
      const notifications = source.notifications.filter(
        (notification) => notification.portfolioId && portfolioIds.has(notification.portfolioId)
      );
      const latestPackage = packages
        .slice()
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0];
      const readyCount = packages.filter((reportPackage) =>
        ["approved", "delivered", "viewed"].includes(reportPackage.status)
      ).length;
      const pendingCount = packages.filter((reportPackage) =>
        ["draft", "pending_approval"].includes(reportPackage.status)
      ).length;
      const failedItemCount = packages.reduce(
        (sum, reportPackage) =>
          sum + reportPackage.items.filter((item) => item.status === "unavailable").length,
        0
      );
      const staleNotificationCount = notifications.filter(
        (notification) => notification.status === "unread"
      ).length;

      return {
        clientId: client.id,
        clientName: client.name,
        householdId: client.householdId,
        readyCount,
        pendingCount,
        failedItemCount,
        staleNotificationCount,
        latestPackageStatus: latestPackage?.status,
        latestPackageUpdatedAt: latestPackage?.updatedAt.toISOString(),
        reportPackageIds: packages.map((reportPackage) => reportPackage.id),
        notificationIds: notifications.map((notification) => notification.id)
      };
    })
    .filter(
      (point) =>
        point.readyCount > 0 ||
        point.pendingCount > 0 ||
        point.failedItemCount > 0 ||
        point.staleNotificationCount > 0
    )
    .sort(
      (left, right) =>
        right.failedItemCount - left.failedItemCount ||
        right.pendingCount - left.pendingCount ||
        left.clientName.localeCompare(right.clientName)
    );
}

function getOrSetDeliveryTimelineBucket(
  buckets: Map<
    string,
    {
      date: string;
      delivered: number;
      viewed: number;
      failed: number;
      revoked: number;
      total: number;
      reportPackageIds: Set<string>;
      eventIds: Set<string>;
    }
  >,
  date: string
) {
  return getOrSet(buckets, date, () => ({
    date,
    delivered: 0,
    viewed: 0,
    failed: 0,
    revoked: 0,
    total: 0,
    reportPackageIds: new Set<string>(),
    eventIds: new Set<string>()
  }));
}

function rangeWindow(range: ComplianceDeliveryChartRange, now: Date): ChartRangeWindow {
  if (range === "all") {
    return {};
  }
  if (range === "ytd") {
    return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0)) };
  }

  const days: Record<Exclude<ComplianceDeliveryChartRange, "all" | "ytd">, number> = {
    "7d": 7,
    "30d": 30,
    "90d": 90,
    "1y": 365
  };
  return { from: new Date(now.getTime() - days[range] * 86_400_000) };
}

function withinWindow(date: Date, window: ChartRangeWindow): boolean {
  return !window.from || date.getTime() >= window.from.getTime();
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dataQualityStatus(
  issues: DataQualityIssue[],
  sourceCount: number
): ComplianceDeliveryDataQualityStatus {
  if (sourceCount === 0) {
    return "empty";
  }
  return issues.some((issue) => issue.severity !== "info") ? "partial" : "complete";
}

function countRedactedAuditMetadataFields(events: AuditEvent[]): number {
  const blockedPattern =
    /(token|secret|password|credential|accountNumber|rawCredential|phone|email|document)/i;
  return events.reduce(
    (sum, event) =>
      sum + Object.keys(event.metadata).filter((key) => blockedPattern.test(key)).length,
    0
  );
}

function isReportPackageStatus(
  value: DeliveryChartsQuery["deliveryStatus"]
): value is ReportPackageStatus {
  return ["draft", "pending_approval", "approved", "delivered", "viewed", "revoked"].includes(
    String(value)
  );
}

function isReportStatus(value: DeliveryChartsQuery["deliveryStatus"]): value is ReportStatus {
  return ["pending", "running", "ready", "failed"].includes(String(value));
}

function isNotificationStatus(
  value: DeliveryChartsQuery["deliveryStatus"]
): value is NotificationStatus {
  return ["unread", "read"].includes(String(value));
}

function isAuditOutcome(
  value: DeliveryChartsQuery["deliveryStatus"]
): value is "success" | "failure" {
  return ["success", "failure"].includes(String(value));
}

function getOrSet<K, V>(map: Map<K, V>, key: K, build: () => V): V {
  const current = map.get(key);
  if (current) {
    return current;
  }
  const created = build();
  map.set(key, created);
  return created;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
