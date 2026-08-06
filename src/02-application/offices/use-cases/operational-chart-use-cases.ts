import { AdvisoryAssignment } from "../../../01-domain/advisory/advisory-team";
import { Actor } from "../../../01-domain/auth/actor";
import {
  ClientOnboardingStatus,
  ClientSummary,
  Household
} from "../../../01-domain/clients/client";
import { AuditEvent } from "../../../01-domain/compliance/audit";
import { ReportPackage } from "../../../01-domain/delivery/report-package";
import { OfficeMembershipRole, OfficeStatus } from "../../../01-domain/offices/office";
import { PortfolioPosition, PortfolioSummary } from "../../../01-domain/portfolios/portfolio";
import { PermissionService } from "../../auth/permission-service";
import { ApplicationError } from "../../errors/application-error";
import { LoggerPort, MetricsPort } from "../../ports/observability";
import {
  AdvisoryTeamRepository,
  AuditRepository,
  ClientRepository,
  OfficeRepository,
  PortfolioRepository,
  ReportPackageRepository
} from "../../ports/repositories";
import { AnalyticsRepository } from "../../../modules/analytics/ports";
import {
  AnalyticsJob,
  DataQualityIssue,
  PortfolioAnalyticsSnapshot
} from "../../../modules/analytics/types";
import { MarketDataJobQueue, MarketDataRepository } from "../../../modules/market-data/ports";
import {
  MarketDataFreshness,
  MarketDataJob,
  ProviderStatusSummary
} from "../../../modules/market-data/types";
import {
  AlertRepository,
  NotificationRepository,
  ReportRepository
} from "../../../modules/reports-alerts/ports";
import { AlertRule, NotificationRecord, ReportJob } from "../../../modules/reports-alerts/types";
import {
  OfficeAdminChartBundle,
  OfficeAdminChartsQuery,
  OfficeAdminChartsResponse,
  OfficeAdminDataQualityStatus,
  OfficeAlertNotificationVolumePoint,
  OfficeAnalyticsQueueHealthPoint,
  OfficeAssignmentLoadPoint,
  OfficeClientGrowthPoint,
  OfficeCoveragePoint,
  OfficeMarketDataFreshnessPoint,
  OfficePermissionActivityPoint,
  OfficeReportFailurePoint,
  OfficeReportThroughputPoint,
  OfficeStaffRoleDistributionPoint,
  PlatformAdminChartBundle,
  PlatformAdminChartsResponse,
  PlatformJobHealthPoint,
  PlatformOfficeVolumePoint,
  PlatformProviderHealthPoint,
  PlatformStaffRoleDistributionPoint,
  PlatformTenantFreshnessPoint
} from "./operational-chart-types";

interface OfficeMemberSource {
  id: string;
  officeId: string;
  userId: string;
  userName: string;
  role: OfficeMembershipRole;
  createdAt: Date;
}

interface PortfolioSource {
  portfolio: PortfolioSummary;
  positions: PortfolioPosition[];
  latestAnalyticsJob?: AnalyticsJob;
  latestSnapshot?: PortfolioAnalyticsSnapshot;
  reports: ReportJob[];
  alerts: AlertRule[];
}

interface OfficeOperationalSource {
  officeId: string;
  clients: ClientSummary[];
  households: Household[];
  members: OfficeMemberSource[];
  assignments: AdvisoryAssignment[];
  portfolios: PortfolioSource[];
  analyticsJobs: AnalyticsJob[];
  marketDataJobs: MarketDataJob[];
  reportPackages: ReportPackage[];
  notifications: NotificationRecord[];
  auditEvents: AuditEvent[];
  providerStatuses: ProviderStatusSummary[];
  generatedIssues: DataQualityIssue[];
}

interface ChartRangeWindow {
  from?: Date;
}

export class GetOfficeAdminChartsUseCase {
  constructor(
    private readonly offices: OfficeRepository,
    private readonly clients: ClientRepository,
    private readonly advisory: AdvisoryTeamRepository,
    private readonly portfolios: PortfolioRepository,
    private readonly analytics: AnalyticsRepository,
    private readonly marketData: MarketDataRepository,
    private readonly marketDataJobs: MarketDataJobQueue,
    private readonly reports: ReportRepository,
    private readonly reportPackages: ReportPackageRepository,
    private readonly alerts: AlertRepository,
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
    query: OfficeAdminChartsQuery
  ): Promise<OfficeAdminChartsResponse> {
    const startedAt = this.now().getTime();
    const evaluation = await this.permissions.evaluate(actor, officeId);
    if (evaluation.role !== "office_admin") {
      this.metrics.increment("office_admin.charts.denied");
      throw new ApplicationError(
        "forbidden",
        "auth.office_admin_chart_scope_denied",
        "Office admin chart scope denied"
      );
    }

    const source = await this.buildOfficeSource(actor, officeId, query);
    const data = buildOfficeChartBundle(
      source,
      query,
      rangeWindow(query.range, this.now()),
      this.now()
    );
    const calculationDurationMs = this.now().getTime() - startedAt;

    this.metrics.increment("office_admin.charts.request");
    if (data.dataQuality.status !== "complete") {
      this.metrics.increment("office_admin.charts.partial");
    }
    this.logger.info("office_admin.charts.generated", {
      actorId: actor.id,
      officeId,
      range: query.range,
      role: query.role,
      workflowStatus: query.workflowStatus,
      provider: query.provider,
      severity: query.severity,
      clientCount: source.clients.length,
      portfolioCount: source.portfolios.length,
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

  async buildOfficeSource(
    actor: Actor,
    officeId: string,
    query: OfficeAdminChartsQuery
  ): Promise<OfficeOperationalSource> {
    const office = await this.offices.findOfficeById(officeId);
    if (!office) {
      throw new ApplicationError("not_found", "office.not_found", "Office not found");
    }

    const window = rangeWindow(query.range, this.now());
    const allClients = await this.clients.listClients(officeId, {});
    const clients = allClients.filter((client) => matchesClientFilters(client, query));
    const clientIds = new Set(clients.map((client) => client.id));
    const households = (await this.clients.listHouseholds(officeId)).filter(
      (household) =>
        !query.workflowStatus ||
        query.workflowStatus === household.status ||
        clients.some((client) => client.householdId === household.id)
    );
    const members = (await this.offices.listOfficeMembers(officeId))
      .filter((member) => !query.role || member.role === query.role)
      .map((member) => ({
        id: member.id,
        officeId: member.officeId,
        userId: member.userId,
        userName: member.userName,
        role: member.role,
        createdAt: member.createdAt
      }));
    const memberUserIds = new Set(members.map((member) => member.userId));
    const assignments = (await this.advisory.listAssignmentsByOffice(officeId)).filter(
      (assignment) => {
        if (
          query.role &&
          assignment.assigneeUserId &&
          !memberUserIds.has(assignment.assigneeUserId)
        ) {
          return false;
        }
        return !query.workflowStatus || matchesAssignmentWorkflow(assignment, query.workflowStatus);
      }
    );
    const visiblePortfolios = (
      await this.portfolios.listVisiblePortfolios(actor.id, actor.role === "admin")
    )
      .filter((portfolio) => portfolio.officeId === officeId)
      .filter(
        (portfolio) => !clientIds.size || !portfolio.clientId || clientIds.has(portfolio.clientId)
      );
    const portfolioIds = new Set(visiblePortfolios.map((portfolio) => portfolio.id));
    const portfolioSources = await Promise.all(
      visiblePortfolios.map(async (portfolio) => {
        const [positions, latestAnalyticsJob, latestSnapshot, reports, alerts] = await Promise.all([
          this.portfolios.listPortfolioPositions(portfolio.id),
          this.analytics.findLatestJob(portfolio.id),
          this.analytics.findLatestSnapshot(portfolio.id),
          this.reports.listReportsByPortfolio(portfolio.id),
          this.alerts.listAlertsByPortfolio(portfolio.id)
        ]);

        return {
          portfolio,
          positions,
          latestAnalyticsJob,
          latestSnapshot,
          reports: reports.filter(
            (report) =>
              withinWindow(report.createdAt, window) &&
              (!query.workflowStatus || report.status === query.workflowStatus)
          ),
          alerts: alerts.filter(
            (alert) =>
              withinWindow(alert.updatedAt, window) &&
              (!query.workflowStatus || alert.status === query.workflowStatus) &&
              (!query.severity || alert.severity === query.severity)
          )
        };
      })
    );
    const analyticsJobs = (await this.analytics.listJobs()).filter(
      (job) =>
        portfolioIds.has(job.portfolioId) &&
        withinWindow(job.updatedAt, window) &&
        (!query.workflowStatus || job.status === query.workflowStatus)
    );
    const assetSymbols = new Set(
      portfolioSources.flatMap((source) => source.positions.map((position) => position.assetSymbol))
    );
    const marketJobs = (await this.marketDataJobs.listJobs()).filter(
      (job) =>
        assetSymbols.has(job.symbol) &&
        withinWindow(job.updatedAt, window) &&
        (!query.workflowStatus || job.status === query.workflowStatus)
    );
    const reportPackages = (
      await Promise.all(
        clients.map((client) => this.reportPackages.listReportPackagesByClient(client.id))
      )
    )
      .flat()
      .filter(
        (reportPackage) =>
          reportPackage.officeId === officeId &&
          withinWindow(reportPackage.updatedAt, window) &&
          (!query.workflowStatus || reportPackage.status === query.workflowStatus)
      );
    const notifications = (
      await this.notifications.listNotificationsByPortfolioIds([...portfolioIds])
    ).filter(
      (notification) =>
        withinWindow(notification.createdAt, window) &&
        (!query.workflowStatus || notification.status === query.workflowStatus) &&
        (!query.severity || notification.severity === query.severity)
    );
    const auditSeverity = normalizeAuditSeverityFilter(query.severity);
    const auditPage = await this.audits.listAuditEvents(officeId, {
      page: 1,
      pageSize: 100,
      from: window.from?.toISOString(),
      severity: auditSeverity
    });
    const auditEvents = auditPage.events.filter(
      (event) =>
        (!query.workflowStatus || event.action.includes(query.workflowStatus)) &&
        (!query.severity || auditSeverity === event.severity || event.severity === query.severity)
    );
    const generatedIssues: DataQualityIssue[] = [];
    if (auditPage.total > auditPage.events.length) {
      generatedIssues.push({
        code: "office_charts.audit_events_truncated",
        severity: "warning",
        message: "Audit event aggregation was limited to the first 100 records for this request."
      });
    }

    const providerStatuses = await this.loadProviderStatuses(
      assetSymbols,
      query.provider,
      generatedIssues
    );
    if (assetSymbols.size > 0 && providerStatuses.length === 0) {
      generatedIssues.push({
        code: "office_charts.provider_status_unavailable",
        severity: "warning",
        message: "Provider status is unavailable for the office tracked assets."
      });
    }
    for (const source of portfolioSources) {
      if (!source.latestSnapshot) {
        generatedIssues.push({
          code: "office_charts.analytics_snapshot_missing",
          severity: "warning",
          message: "At least one office portfolio has no completed analytics snapshot."
        });
        break;
      }
    }

    return {
      officeId,
      clients,
      households,
      members,
      assignments,
      portfolios: portfolioSources,
      analyticsJobs,
      marketDataJobs: marketJobs,
      reportPackages,
      notifications,
      auditEvents,
      providerStatuses,
      generatedIssues
    };
  }

  private async loadProviderStatuses(
    assetSymbols: Set<string>,
    providerFilter: string | undefined,
    issues: DataQualityIssue[]
  ): Promise<ProviderStatusSummary[]> {
    const providerNames = new Set<string>();
    for (const symbol of assetSymbols) {
      const asset = await this.marketData.findAssetBySymbol(symbol);
      if (asset?.providerName) {
        providerNames.add(asset.providerName);
      }
    }

    const normalizedFilter = providerFilter?.trim().toLowerCase();
    const selectedProviderNames = [...providerNames].filter(
      (providerName) => !normalizedFilter || providerName.toLowerCase() === normalizedFilter
    );
    const statuses: ProviderStatusSummary[] = [];
    for (const providerName of selectedProviderNames) {
      try {
        statuses.push(await this.marketData.getProviderStatus(providerName));
      } catch {
        issues.push({
          code: "office_charts.provider_status_failed",
          severity: "warning",
          message: "A market data provider status could not be read."
        });
      }
    }

    return statuses;
  }
}

export class GetPlatformAdminChartsUseCase {
  constructor(
    private readonly officeCharts: GetOfficeAdminChartsUseCase,
    private readonly offices: OfficeRepository,
    private readonly logger: LoggerPort,
    private readonly metrics: MetricsPort,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(actor: Actor, query: OfficeAdminChartsQuery): Promise<PlatformAdminChartsResponse> {
    if (actor.role !== "admin") {
      this.metrics.increment("platform_admin.charts.denied");
      throw new ApplicationError(
        "forbidden",
        "auth.platform_chart_scope_denied",
        "Platform chart scope denied"
      );
    }

    const startedAt = this.now().getTime();
    const officeSummaries = await this.offices.listOfficesForUser(actor.id, true);
    const officeSources = await Promise.all(
      officeSummaries.map((office) =>
        this.officeCharts.buildOfficeSource(actor, office.officeId, query)
      )
    );
    const data = await buildPlatformChartBundle(
      officeSources,
      await Promise.all(
        officeSummaries.map((office) => this.offices.findOfficeById(office.officeId))
      ),
      query,
      rangeWindow(query.range, this.now())
    );
    const calculationDurationMs = this.now().getTime() - startedAt;

    this.metrics.increment("platform_admin.charts.request");
    if (data.dataQuality.status !== "complete") {
      this.metrics.increment("platform_admin.charts.partial");
    }
    this.logger.info("platform_admin.charts.generated", {
      actorId: actor.id,
      range: query.range,
      role: query.role,
      workflowStatus: query.workflowStatus,
      provider: query.provider,
      severity: query.severity,
      officeCount: officeSources.length,
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

function buildOfficeChartBundle(
  source: OfficeOperationalSource,
  query: OfficeAdminChartsQuery,
  window: ChartRangeWindow,
  now: Date
): OfficeAdminChartBundle {
  const flatReports = source.portfolios.flatMap((portfolioSource) => portfolioSource.reports);
  const flatAlerts = source.portfolios.flatMap((portfolioSource) => portfolioSource.alerts);
  const allPositions = source.portfolios.flatMap((portfolioSource) =>
    portfolioSource.positions.map((position) => ({
      position,
      portfolioId: portfolioSource.portfolio.id
    }))
  );
  const issues = uniqueIssues(source.generatedIssues);

  return {
    officeId: source.officeId,
    range: query.range,
    filters: {
      role: query.role,
      workflowStatus: query.workflowStatus,
      provider: query.provider,
      severity: query.severity
    },
    charts: {
      clientGrowth: buildClientGrowth(source, window, now),
      onboardingFunnel: buildOnboardingFunnel(source.clients),
      staffRoleDistribution: buildStaffRoleDistribution(source.members),
      assignmentLoad: buildAssignmentLoad(source.assignments, source.members),
      portfolioCoverage: buildPortfolioCoverage(source.portfolios),
      assetCoverage: buildAssetCoverage(allPositions),
      marketDataFreshness: buildMarketDataFreshness(source.providerStatuses, source.marketDataJobs),
      analyticsQueueHealth: buildAnalyticsQueueHealth(source.portfolios, source.analyticsJobs),
      reportThroughput: buildReportThroughput(flatReports, source.reportPackages),
      reportFailures: buildReportFailures(flatReports),
      alertNotificationVolume: buildAlertNotificationVolume(flatAlerts, source.notifications),
      permissionActivity: buildPermissionActivity(source.auditEvents, source.assignments)
    },
    dataQuality: {
      status: resolveOfficeQualityStatus(source, issues, now),
      issues,
      sourceCounts: {
        clients: source.clients.length,
        households: source.households.length,
        accounts: sourceCountsAccounts(source.clients, source.portfolios),
        portfolios: source.portfolios.length,
        staff: source.members.length,
        assignments: source.assignments.length,
        analyticsJobs: source.analyticsJobs.length,
        reports: flatReports.length,
        reportPackages: source.reportPackages.length,
        alerts: flatAlerts.length,
        notifications: source.notifications.length,
        auditEvents: source.auditEvents.length
      }
    }
  };
}

async function buildPlatformChartBundle(
  sources: OfficeOperationalSource[],
  offices: Array<{ status: OfficeStatus } | undefined>,
  query: OfficeAdminChartsQuery,
  window: ChartRangeWindow
): Promise<PlatformAdminChartBundle> {
  const issues = uniqueIssues(sources.flatMap((source) => source.generatedIssues));
  const officeStatusDistribution = countBy(
    offices.filter(isDefinedOffice),
    (office) => office.status
  ).map(([status, count]) => ({ status, count }));
  const flatMembers = sources.flatMap((source) => source.members);
  const flatPortfolios = sources.flatMap((source) => source.portfolios);
  const flatReports = flatPortfolios.flatMap((portfolio) => portfolio.reports);
  const flatReportPackages = sources.flatMap((source) => source.reportPackages);
  const flatAlerts = flatPortfolios.flatMap((portfolio) => portfolio.alerts);
  const flatNotifications = sources.flatMap((source) => source.notifications);
  const flatPermissionActivity = sources.flatMap((source) => source.auditEvents);
  const flatProviderStatuses = sources.flatMap((source) => source.providerStatuses);

  return {
    platformId: "global",
    range: query.range,
    filters: {
      role: query.role,
      workflowStatus: query.workflowStatus,
      provider: query.provider,
      severity: query.severity
    },
    charts: {
      officeStatusDistribution,
      officeVolume: buildPlatformOfficeVolume(sources),
      staffRoleDistribution: buildPlatformStaffRoleDistribution(flatMembers),
      tenantDataFreshness: buildPlatformTenantFreshness(sources),
      providerHealth: buildPlatformProviderHealth(flatProviderStatuses),
      jobHealth: buildPlatformJobHealth(sources),
      reportThroughput: buildReportThroughput(flatReports, flatReportPackages).map(
        ({ reportIds: _reportIds, reportPackageIds: _reportPackageIds, ...point }) => point
      ),
      alertNotificationVolume: buildAlertNotificationVolume(flatAlerts, flatNotifications)
        .filter((point) => withinWindow(new Date(`${point.date}T00:00:00.000Z`), window))
        .map(({ alertIds: _alertIds, notificationIds: _notificationIds, ...point }) => point),
      permissionActivity: buildPermissionActivity(
        flatPermissionActivity,
        sources.flatMap((source) => source.assignments)
      ).map(({ eventIds: _eventIds, assignmentIds: _assignmentIds, ...point }) => point)
    },
    dataQuality: {
      status: resolvePlatformQualityStatus(sources, issues),
      issues,
      sourceCounts: {
        offices: sources.length,
        clients: sources.reduce((sum, source) => sum + source.clients.length, 0),
        households: sources.reduce((sum, source) => sum + source.households.length, 0),
        accounts: sources.reduce(
          (sum, source) => sum + sourceCountsAccounts(source.clients, source.portfolios),
          0
        ),
        portfolios: flatPortfolios.length,
        staff: flatMembers.length,
        assignments: sources.reduce((sum, source) => sum + source.assignments.length, 0),
        analyticsJobs: sources.reduce((sum, source) => sum + source.analyticsJobs.length, 0),
        marketDataJobs: sources.reduce((sum, source) => sum + source.marketDataJobs.length, 0),
        reports: flatReports.length,
        reportPackages: flatReportPackages.length,
        alerts: flatAlerts.length,
        notifications: flatNotifications.length,
        auditEvents: flatPermissionActivity.length
      }
    }
  };
}

function buildClientGrowth(
  source: OfficeOperationalSource,
  window: ChartRangeWindow,
  now: Date
): OfficeClientGrowthPoint[] {
  const dates = new Set<string>();
  for (const client of source.clients) {
    if (withinWindow(client.createdAt, window)) {
      dates.add(toDateKey(client.createdAt));
    }
  }
  for (const household of source.households) {
    if (withinWindow(household.createdAt, window)) {
      dates.add(toDateKey(household.createdAt));
    }
  }
  for (const portfolio of source.portfolios) {
    const createdAt = new Date(portfolio.portfolio.lastTransactionDate ?? "1970-01-01");
    if (withinWindow(createdAt, window)) {
      dates.add(toDateKey(createdAt));
    }
  }
  for (const member of source.members) {
    if (withinWindow(member.createdAt, window)) {
      dates.add(toDateKey(member.createdAt));
    }
  }

  if (dates.size === 0) {
    dates.add(toDateKey(now));
  }

  return [...dates].sort().map((date) => {
    const asOf = new Date(`${date}T23:59:59.999Z`);
    const clients = source.clients.filter((client) => client.createdAt <= asOf);
    const households = source.households.filter((household) => household.createdAt <= asOf);
    const portfolios = source.portfolios.filter((portfolio) => {
      const portfolioDate = new Date(portfolio.portfolio.lastTransactionDate ?? date);
      return portfolioDate <= asOf;
    });
    const staff = source.members.filter((member) => member.createdAt <= asOf);

    return {
      date,
      clients: clients.length,
      households: households.length,
      accounts: sourceCountsAccounts(clients, portfolios),
      portfolios: portfolios.length,
      staff: staff.length,
      clientIds: clients.map((client) => client.id),
      householdIds: households.map((household) => household.id),
      portfolioIds: portfolios.map((portfolio) => portfolio.portfolio.id),
      staffUserIds: staff.map((member) => member.userId)
    };
  });
}

function buildOnboardingFunnel(clients: ClientSummary[]) {
  const statuses: ClientOnboardingStatus[] = ["invited", "onboarding", "complete", "paused"];
  return statuses.map((status) => {
    const matching = clients.filter((client) => client.onboardingStatus === status);
    return {
      status,
      count: matching.length,
      clientIds: matching.map((client) => client.id)
    };
  });
}

function buildStaffRoleDistribution(
  members: OfficeMemberSource[]
): OfficeStaffRoleDistributionPoint[] {
  const roles: OfficeMembershipRole[] = [
    "office_admin",
    "advisor",
    "analyst",
    "assistant",
    "client"
  ];
  return roles.map((role) => {
    const matching = members.filter((member) => member.role === role);
    return {
      role,
      count: matching.length,
      userIds: matching.map((member) => member.userId)
    };
  });
}

function buildAssignmentLoad(
  assignments: AdvisoryAssignment[],
  members: OfficeMemberSource[]
): OfficeAssignmentLoadPoint[] {
  const activeAssignments = assignments.filter((assignment) => !assignment.revokedAt);
  const pointsByKey = new Map<string, OfficeAssignmentLoadPoint>();
  for (const assignment of activeAssignments) {
    const key = assignment.assigneeUserId
      ? `user:${assignment.assigneeUserId}`
      : assignment.teamId
        ? `team:${assignment.teamId}`
        : "unassigned";
    const member = assignment.assigneeUserId
      ? members.find((candidate) => candidate.userId === assignment.assigneeUserId)
      : undefined;
    const point = pointsByKey.get(key) ?? {
      assigneeUserId: assignment.assigneeUserId,
      assigneeName: member?.userName ?? (assignment.teamId ? "Time atribuído" : "Sem responsável"),
      role: member?.role,
      teamId: assignment.teamId,
      teamName: assignment.teamId ? "Time de assessoria" : undefined,
      clientCount: 0,
      householdCount: 0,
      accountCount: 0,
      portfolioCount: 0,
      totalAssignments: 0,
      assignmentIds: []
    };
    if (assignment.resourceType === "client") {
      point.clientCount += 1;
    } else if (assignment.resourceType === "household") {
      point.householdCount += 1;
    } else if (assignment.resourceType === "account") {
      point.accountCount += 1;
    } else if (assignment.resourceType === "portfolio") {
      point.portfolioCount += 1;
    }
    point.totalAssignments += 1;
    point.assignmentIds.push(assignment.id);
    pointsByKey.set(key, point);
  }

  return [...pointsByKey.values()].sort(
    (left, right) =>
      right.totalAssignments - left.totalAssignments ||
      left.assigneeName.localeCompare(right.assigneeName)
  );
}

function buildPortfolioCoverage(portfolios: PortfolioSource[]): OfficeCoveragePoint[] {
  const points = new Map<string, OfficeCoveragePoint>();
  for (const source of portfolios) {
    const key = `${source.portfolio.status}:${source.portfolio.freshness}`;
    const point = points.get(key) ?? {
      status: source.portfolio.status,
      freshness: source.portfolio.freshness,
      count: 0,
      totalCostBasis: 0,
      portfolioIds: []
    };
    point.count += 1;
    point.totalCostBasis = round(point.totalCostBasis + source.portfolio.totalCostBasis);
    point.portfolioIds.push(source.portfolio.id);
    points.set(key, point);
  }
  return [...points.values()].sort((left, right) => right.count - left.count);
}

function buildAssetCoverage(
  positions: Array<{ position: PortfolioPosition; portfolioId: string }>
) {
  const points = new Map<
    string,
    {
      assetSymbol: string;
      assetName: string;
      portfolioIds: Set<string>;
      totalQuantity: number;
      totalCostBasis: number;
    }
  >();
  for (const { position, portfolioId } of positions) {
    const point = points.get(position.assetSymbol) ?? {
      assetSymbol: position.assetSymbol,
      assetName: position.assetName,
      portfolioIds: new Set<string>(),
      totalQuantity: 0,
      totalCostBasis: 0
    };
    point.portfolioIds.add(portfolioId);
    point.totalQuantity = round(point.totalQuantity + position.quantity, 8);
    point.totalCostBasis = round(point.totalCostBasis + position.totalCostBasis);
    points.set(position.assetSymbol, point);
  }

  return [...points.values()]
    .map((point) => ({
      assetSymbol: point.assetSymbol,
      assetName: point.assetName,
      portfolioCount: point.portfolioIds.size,
      totalQuantity: point.totalQuantity,
      totalCostBasis: point.totalCostBasis,
      portfolioIds: [...point.portfolioIds].sort()
    }))
    .sort((left, right) => right.totalCostBasis - left.totalCostBasis);
}

function buildMarketDataFreshness(
  providerStatuses: ProviderStatusSummary[],
  jobs: MarketDataJob[]
): OfficeMarketDataFreshnessPoint[] {
  if (providerStatuses.length === 0 && jobs.length === 0) {
    return [];
  }

  const jobsByProvider = new Map<string, MarketDataJob[]>();
  for (const job of jobs) {
    const providerName = "unconfigured";
    jobsByProvider.set(providerName, [...(jobsByProvider.get(providerName) ?? []), job]);
  }

  const statusPoints = providerStatuses.map((status) => {
    const providerJobs = jobsByProvider.get(status.providerName) ?? [];
    return {
      providerName: status.providerName,
      status: status.status,
      freshness: resolveProviderFreshness(status, providerJobs),
      requestCount: status.requestCount,
      errorCount: status.errorCount,
      averageLatencyMs: status.averageLatencyMs,
      jobCount: providerJobs.length,
      failedJobCount: providerJobs.filter((job) => job.status === "failed").length,
      lastSuccessAt: status.lastSuccessAt,
      lastFailureAt: status.lastFailureAt,
      lastErrorCode: status.lastErrorCode
    };
  });

  if (statusPoints.length === 0 && jobs.length > 0) {
    return [
      {
        providerName: "unconfigured",
        status: "unconfigured",
        freshness: jobs.some((job) => job.status === "failed") ? "stale" : "partial",
        requestCount: 0,
        errorCount: jobs.filter((job) => job.status === "failed").length,
        averageLatencyMs: 0,
        jobCount: jobs.length,
        failedJobCount: jobs.filter((job) => job.status === "failed").length
      }
    ];
  }

  return statusPoints;
}

function buildAnalyticsQueueHealth(
  portfolios: PortfolioSource[],
  analyticsJobs: AnalyticsJob[]
): OfficeAnalyticsQueueHealthPoint[] {
  const grouped = new Map<string, OfficeAnalyticsQueueHealthPoint>();
  for (const job of analyticsJobs) {
    const point = grouped.get(job.status) ?? {
      status: job.status,
      count: 0,
      failedCount: 0,
      portfolioIds: [],
      latestUpdatedAt: undefined
    };
    point.count += 1;
    if (job.status === "failed") {
      point.failedCount += 1;
    }
    point.portfolioIds.push(job.portfolioId);
    point.latestUpdatedAt = latestIso(point.latestUpdatedAt, job.updatedAt);
    grouped.set(job.status, point);
  }

  const portfoliosWithoutJobs = portfolios.filter((source) => !source.latestAnalyticsJob);
  if (portfoliosWithoutJobs.length > 0) {
    grouped.set("missing", {
      status: "missing",
      count: portfoliosWithoutJobs.length,
      failedCount: 0,
      portfolioIds: portfoliosWithoutJobs.map((source) => source.portfolio.id)
    });
  }

  return [...grouped.values()].sort((left, right) => right.count - left.count);
}

function buildReportThroughput(
  reports: ReportJob[],
  reportPackages: ReportPackage[]
): OfficeReportThroughputPoint[] {
  const points = new Map<string, OfficeReportThroughputPoint>();
  for (const report of reports) {
    const point = points.get(report.status) ?? {
      status: report.status,
      count: 0,
      portfolioCount: 0,
      reportIds: [],
      reportPackageIds: []
    };
    point.count += 1;
    point.portfolioCount = new Set([...point.reportIds, report.portfolioId]).size;
    point.reportIds.push(report.id);
    point.latestUpdatedAt = latestIso(point.latestUpdatedAt, report.updatedAt);
    points.set(report.status, point);
  }
  for (const reportPackage of reportPackages) {
    const point = points.get(reportPackage.status) ?? {
      status: reportPackage.status,
      count: 0,
      portfolioCount: 0,
      reportIds: [],
      reportPackageIds: []
    };
    const portfolioIds = new Set(
      reportPackage.items.map((item) => item.portfolioId).filter(isString)
    );
    point.count += 1;
    point.portfolioCount += portfolioIds.size;
    point.reportPackageIds.push(reportPackage.id);
    point.latestUpdatedAt = latestIso(point.latestUpdatedAt, reportPackage.updatedAt);
    points.set(reportPackage.status, point);
  }

  return [...points.values()].sort((left, right) => right.count - left.count);
}

function buildReportFailures(reports: ReportJob[]): OfficeReportFailurePoint[] {
  const points = new Map<string, OfficeReportFailurePoint>();
  for (const report of reports.filter((entry) => entry.status === "failed")) {
    const failureCode = report.failureCode ?? "unknown_failure";
    const point = points.get(failureCode) ?? {
      failureCode,
      count: 0,
      reportIds: [],
      portfolioIds: [],
      latestFailedAt: undefined
    };
    point.count += 1;
    point.reportIds.push(report.id);
    point.portfolioIds.push(report.portfolioId);
    point.latestFailedAt = latestIso(point.latestFailedAt, report.completedAt ?? report.updatedAt);
    points.set(failureCode, point);
  }
  return [...points.values()].sort((left, right) => right.count - left.count);
}

function buildAlertNotificationVolume(
  alerts: AlertRule[],
  notifications: NotificationRecord[]
): OfficeAlertNotificationVolumePoint[] {
  const points = new Map<string, OfficeAlertNotificationVolumePoint>();
  for (const alert of alerts) {
    const date = toDateKey(alert.updatedAt);
    const point = ensureVolumePoint(points, date);
    point[alert.severity] += 1;
    point.total += 1;
    point.alertIds.push(alert.id);
  }
  for (const notification of notifications) {
    const date = toDateKey(notification.createdAt);
    const point = ensureVolumePoint(points, date);
    if (notification.severity === "info") {
      point.info += 1;
    } else {
      point[notification.severity] += 1;
    }
    point.total += 1;
    point.notificationIds.push(notification.id);
  }

  return [...points.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function buildPermissionActivity(
  auditEvents: AuditEvent[],
  assignments: AdvisoryAssignment[]
): OfficePermissionActivityPoint[] {
  const points = new Map<string, OfficePermissionActivityPoint>();
  for (const event of auditEvents.filter((entry) => entry.resourceType === "permission")) {
    const date = toDateKey(event.createdAt);
    const point = ensurePermissionPoint(points, date);
    if (event.action.includes("revoked")) {
      point.revoked += 1;
    } else if (event.action.includes("role")) {
      point.roleChanges += 1;
    } else {
      point.created += 1;
    }
    point.total += 1;
    point.eventIds.push(event.id);
  }
  for (const assignment of assignments.filter((entry) => entry.revokedAt)) {
    const date = toDateKey(assignment.revokedAt as Date);
    const point = ensurePermissionPoint(points, date);
    point.revoked += 1;
    point.total += 1;
    point.assignmentIds.push(assignment.id);
  }

  return [...points.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function buildPlatformOfficeVolume(
  sources: OfficeOperationalSource[]
): PlatformOfficeVolumePoint[] {
  return [
    { bucket: "offices", count: sources.length },
    { bucket: "clients", count: sources.reduce((sum, source) => sum + source.clients.length, 0) },
    {
      bucket: "households",
      count: sources.reduce((sum, source) => sum + source.households.length, 0)
    },
    {
      bucket: "accounts",
      count: sources.reduce(
        (sum, source) => sum + sourceCountsAccounts(source.clients, source.portfolios),
        0
      )
    },
    {
      bucket: "portfolios",
      count: sources.reduce((sum, source) => sum + source.portfolios.length, 0)
    },
    { bucket: "staff", count: sources.reduce((sum, source) => sum + source.members.length, 0) }
  ];
}

function buildPlatformStaffRoleDistribution(
  members: OfficeMemberSource[]
): PlatformStaffRoleDistributionPoint[] {
  return buildStaffRoleDistribution(members).map(({ userIds: _userIds, ...point }) => point);
}

function buildPlatformTenantFreshness(
  sources: OfficeOperationalSource[]
): PlatformTenantFreshnessPoint[] {
  const freshnessValues: MarketDataFreshness[] = ["fresh", "partial", "stale"];
  return freshnessValues.map((freshness) => {
    const sourcesWithFreshness = sources.filter((source) =>
      source.portfolios.some((portfolio) => portfolio.portfolio.freshness === freshness)
    );
    return {
      freshness,
      officeCount: sourcesWithFreshness.length,
      portfolioCount: sources.reduce(
        (sum, source) =>
          sum +
          source.portfolios.filter((portfolio) => portfolio.portfolio.freshness === freshness)
            .length,
        0
      )
    };
  });
}

function buildPlatformProviderHealth(
  providerStatuses: ProviderStatusSummary[]
): PlatformProviderHealthPoint[] {
  const byProvider = new Map<string, PlatformProviderHealthPoint>();
  for (const providerStatus of providerStatuses) {
    const point = byProvider.get(providerStatus.providerName) ?? {
      providerName: providerStatus.providerName,
      status: providerStatus.status,
      requestCount: 0,
      errorCount: 0,
      averageLatencyMs: 0
    };
    point.status = mergeProviderStatus(point.status, providerStatus.status);
    point.requestCount += providerStatus.requestCount;
    point.errorCount += providerStatus.errorCount;
    point.averageLatencyMs = Math.round(
      (point.averageLatencyMs + providerStatus.averageLatencyMs) / 2
    );
    byProvider.set(providerStatus.providerName, point);
  }
  return [...byProvider.values()].sort((left, right) =>
    left.providerName.localeCompare(right.providerName)
  );
}

function buildPlatformJobHealth(sources: OfficeOperationalSource[]): PlatformJobHealthPoint[] {
  const points = new Map<string, PlatformJobHealthPoint>();
  for (const source of sources) {
    for (const job of source.analyticsJobs) {
      incrementJobHealth(points, "analytics", job.status);
    }
    for (const job of source.marketDataJobs) {
      incrementJobHealth(points, "market_data", job.status);
    }
    for (const report of source.portfolios.flatMap((portfolio) => portfolio.reports)) {
      incrementJobHealth(points, "report", report.status);
    }
  }
  return [...points.values()].sort(
    (left, right) => left.kind.localeCompare(right.kind) || right.count - left.count
  );
}

function incrementJobHealth(
  points: Map<string, PlatformJobHealthPoint>,
  kind: PlatformJobHealthPoint["kind"],
  status: string
) {
  const key = `${kind}:${status}`;
  const point = points.get(key) ?? { kind, status, count: 0 };
  point.count += 1;
  points.set(key, point);
}

function matchesClientFilters(client: ClientSummary, query: OfficeAdminChartsQuery): boolean {
  if (!query.workflowStatus) {
    return true;
  }
  return client.status === query.workflowStatus || client.onboardingStatus === query.workflowStatus;
}

function matchesAssignmentWorkflow(
  assignment: AdvisoryAssignment,
  workflowStatus: string
): boolean {
  if (workflowStatus === "revoked") {
    return Boolean(assignment.revokedAt);
  }
  if (workflowStatus === "active") {
    return !assignment.revokedAt;
  }
  return true;
}

function rangeWindow(range: OfficeAdminChartsQuery["range"], now: Date): ChartRangeWindow {
  if (range === "all") {
    return {};
  }
  if (range === "ytd") {
    return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)) };
  }

  const days: Record<Exclude<OfficeAdminChartsQuery["range"], "all" | "ytd">, number> = {
    "7d": 7,
    "30d": 30,
    "90d": 90,
    "1y": 365
  };
  return { from: new Date(now.getTime() - days[range] * 24 * 60 * 60 * 1000) };
}

function withinWindow(date: Date, window: ChartRangeWindow): boolean {
  return !window.from || date.getTime() >= window.from.getTime();
}

function resolveOfficeQualityStatus(
  source: OfficeOperationalSource,
  issues: DataQualityIssue[],
  now: Date
): OfficeAdminDataQualityStatus {
  if (
    source.clients.length === 0 &&
    source.households.length === 0 &&
    source.portfolios.length === 0 &&
    source.members.length === 0
  ) {
    return "empty";
  }

  if (
    source.portfolios.some((portfolio) => portfolio.portfolio.freshness === "stale") ||
    source.analyticsJobs.some((job) => job.status === "failed") ||
    source.marketDataJobs.some((job) => job.status === "failed")
  ) {
    return "stale";
  }

  const staleAudit = source.auditEvents.some(
    (event) =>
      now.getTime() - event.createdAt.getTime() > 24 * 60 * 60 * 1000 && event.outcome === "failure"
  );
  if (staleAudit) {
    return "partial";
  }

  return issues.some((issue) => issue.severity !== "info") ? "partial" : "complete";
}

function resolvePlatformQualityStatus(
  sources: OfficeOperationalSource[],
  issues: DataQualityIssue[]
): OfficeAdminDataQualityStatus {
  if (sources.length === 0) {
    return "empty";
  }
  if (
    sources.some(
      (source) =>
        source.portfolios.some((portfolio) => portfolio.portfolio.freshness === "stale") ||
        source.analyticsJobs.some((job) => job.status === "failed") ||
        source.marketDataJobs.some((job) => job.status === "failed")
    )
  ) {
    return "stale";
  }
  return issues.some((issue) => issue.severity !== "info") ? "partial" : "complete";
}

function resolveProviderFreshness(
  status: ProviderStatusSummary,
  jobs: MarketDataJob[]
): MarketDataFreshness {
  if (status.status === "unavailable" || jobs.some((job) => job.status === "failed")) {
    return "stale";
  }
  if (
    status.status === "degraded" ||
    jobs.some((job) => job.status === "queued" || job.status === "running")
  ) {
    return "partial";
  }
  return "fresh";
}

function mergeProviderStatus(
  current: PlatformProviderHealthPoint["status"],
  next: ProviderStatusSummary["status"]
): PlatformProviderHealthPoint["status"] {
  if (current === "unavailable" || next === "unavailable") {
    return "unavailable";
  }
  if (current === "degraded" || next === "degraded") {
    return "degraded";
  }
  return next;
}

function sourceCountsAccounts(clients: ClientSummary[], portfolios: PortfolioSource[]): number {
  return Math.max(
    new Set(portfolios.map((source) => source.portfolio.accountId)).size,
    clients.reduce((sum, client) => sum + client.accountCount, 0)
  );
}

function normalizeAuditSeverityFilter(severity: OfficeAdminChartsQuery["severity"]) {
  if (severity === "info" || severity === "warning" || severity === "critical") {
    return severity;
  }
  return undefined;
}

function ensureVolumePoint(
  points: Map<string, OfficeAlertNotificationVolumePoint>,
  date: string
): OfficeAlertNotificationVolumePoint {
  const point = points.get(date) ?? {
    date,
    low: 0,
    medium: 0,
    high: 0,
    info: 0,
    total: 0,
    alertIds: [],
    notificationIds: []
  };
  points.set(date, point);
  return point;
}

function ensurePermissionPoint(
  points: Map<string, OfficePermissionActivityPoint>,
  date: string
): OfficePermissionActivityPoint {
  const point = points.get(date) ?? {
    date,
    created: 0,
    revoked: 0,
    roleChanges: 0,
    total: 0,
    eventIds: [],
    assignmentIds: []
  };
  points.set(date, point);
  return point;
}

function latestIso(current: string | undefined, next: Date): string {
  const nextIso = next.toISOString();
  return !current || nextIso > current ? nextIso : current;
}

function uniqueIssues(issues: DataQualityIssue[]): DataQualityIssue[] {
  const byCode = new Map<string, DataQualityIssue>();
  for (const issue of issues) {
    if (!byCode.has(issue.code)) {
      byCode.set(issue.code, issue);
    }
  }
  return [...byCode.values()];
}

function countBy<T, K extends string>(
  entries: T[],
  keySelector: (entry: T) => K
): Array<[K, number]> {
  const counts = new Map<K, number>();
  for (const entry of entries) {
    const key = keySelector(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()];
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function isDefinedOffice(
  office: { status: OfficeStatus } | undefined
): office is { status: OfficeStatus } {
  return Boolean(office);
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}
