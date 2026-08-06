import { Actor } from "../../../01-domain/auth/actor";
import { ClientSummary, ClientStatus } from "../../../01-domain/clients/client";
import { PortfolioSummary } from "../../../01-domain/portfolios/portfolio";
import { ReviewItem } from "../../../01-domain/workbench/workbench";
import { ReportPackage } from "../../../01-domain/delivery/report-package";
import {
  PermissionEvaluation,
  PermissionService
} from "../../auth/permission-service";
import { ApplicationError } from "../../errors/application-error";
import { LoggerPort, MetricsPort } from "../../ports/observability";
import {
  AccountRepository,
  AdvisoryTeamRepository,
  ClientRepository,
  PortfolioRepository,
  ReportPackageRepository,
  WorkbenchRepository
} from "../../ports/repositories";
import { AnalyticsRepository } from "../../../modules/analytics/ports";
import {
  DataQualityIssue,
  PortfolioAnalyticsSnapshot,
  SectorExposurePoint
} from "../../../modules/analytics/types";
import { AlertRepository } from "../../../modules/reports-alerts/ports";
import { AlertRule } from "../../../modules/reports-alerts/types";
import { round } from "../../../modules/analytics/formulas";
import {
  AdvisorAlertSeverityTimelinePoint,
  AdvisorAllocationBreakdownPoint,
  AdvisorAssignmentScope,
  AdvisorBookValueTrendPoint,
  AdvisorChartBundle,
  AdvisorChartDataQualityStatus,
  AdvisorChartsQuery,
  AdvisorChartsResponse,
  AdvisorClientRiskDistributionPoint,
  AdvisorFreshness,
  AdvisorNeedsAttentionItem,
  AdvisorReportPipelinePoint,
  AdvisorRiskBand,
  AdvisorRiskReturnPoint,
  AdvisorSectorHeatmapCell,
  AdvisorStaleDataBacklogItem,
  AdvisorWorkbenchAgingPoint
} from "./advisor-chart-types";

const CLIENT_STATUSES: ClientStatus[] = ["active", "inactive", "archived"];

interface PortfolioChartSource {
  portfolio: PortfolioSummary;
  client?: ClientSummary;
  snapshot?: PortfolioAnalyticsSnapshot;
}

interface ClientChartSource {
  client: ClientSummary;
  portfolios: PortfolioChartSource[];
  reportPackages: ReportPackage[];
  reviewItems: ReviewItem[];
  alerts: AlertRule[];
  value: number;
  riskBand: AdvisorRiskBand;
  freshness: AdvisorFreshness;
  maxDrawdownPercent?: number;
  volatilityPercent?: number;
}

export class GetAdvisorChartsUseCase {
  constructor(
    private readonly clients: ClientRepository,
    private readonly accounts: AccountRepository,
    private readonly portfolios: PortfolioRepository,
    private readonly workbench: WorkbenchRepository,
    private readonly reportPackages: ReportPackageRepository,
    private readonly advisory: AdvisoryTeamRepository,
    private readonly analytics: AnalyticsRepository,
    private readonly alerts: AlertRepository,
    private readonly permissions: PermissionService,
    private readonly logger: LoggerPort,
    private readonly metrics: MetricsPort,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    actor: Actor,
    officeId: string,
    query: AdvisorChartsQuery
  ): Promise<AdvisorChartsResponse> {
    const startedAt = this.now().getTime();
    const evaluation = await this.permissions.evaluate(actor, officeId);
    assertStaffAdvisorChartAccess(evaluation);
    const assignmentScope = resolveAssignmentScope(evaluation);
    const requestedAdvisorUserId = query.advisorUserId?.trim();
    if (
      requestedAdvisorUserId &&
      requestedAdvisorUserId !== actor.id &&
      assignmentScope !== "office_admin"
    ) {
      this.metrics.increment("advisor.charts.denied");
      throw new ApplicationError(
        "forbidden",
        "auth.advisor_chart_scope_denied",
        "Advisor chart scope denied"
      );
    }

    const advisorUserId = requestedAdvisorUserId || actor.id;
    const clientStatuses = parseClientStatuses(query.clientStatus);
    const allOfficeClients = await this.clients.listClients(officeId, {});
    const visibleClientIds = await this.visibleClientIdsForAdvisor(
      officeId,
      advisorUserId,
      query.teamId,
      allOfficeClients
    );
    const selectedClients = allOfficeClients
      .filter((client) => visibleClientIds.has(client.id))
      .filter((client) => clientStatuses.length === 0 || clientStatuses.includes(client.status))
      .sort((left, right) => left.name.localeCompare(right.name));
    const reviewItems = await this.workbench.listReviewItems(officeId, {}, visibleClientIds);
    const rangeStart = startDateForRange(query.range, this.now());
    const issues: DataQualityIssue[] = [];

    const clientSources = await Promise.all(
      selectedClients.map((client) =>
        this.buildClientSource(client, reviewItems, rangeStart, issues)
      )
    );
    const filteredSources = clientSources.filter((source) =>
      matchesRiskAndFreshness(source, query.riskBand, query.freshness)
    );
    const portfolioSources = filteredSources.flatMap((source) => source.portfolios);
    const analyticsSnapshots = portfolioSources.filter((source) => source.snapshot).length;
    const reportPackageCount = filteredSources.reduce(
      (sum, source) => sum + source.reportPackages.length,
      0
    );
    const alertCount = filteredSources.reduce((sum, source) => sum + source.alerts.length, 0);
    const filteredReviewItems = filteredSources.flatMap((source) => source.reviewItems);

    if (selectedClients.length > 0 && analyticsSnapshots < portfolioSources.length) {
      issues.push({
        code: "advisor_charts.analytics_partial",
        severity: "warning",
        message: "Some assigned portfolios do not have a completed analytics snapshot."
      });
    }

    const bundle: AdvisorChartBundle = {
      officeId,
      advisorUserId,
      range: query.range,
      filters: {
        teamId: query.teamId,
        clientStatus: clientStatuses,
        riskBand: query.riskBand,
        freshness: query.freshness
      },
      charts: {
        bookValueTrend: buildBookValueTrend(portfolioSources, rangeStart),
        riskReturnScatter: portfolioSources.map(buildRiskReturnPoint),
        drawdownDistribution: filteredSources.map((source) =>
          buildClientRiskDistributionPoint(source, "maxDrawdown")
        ),
        volatilityDistribution: filteredSources.map((source) =>
          buildClientRiskDistributionPoint(source, "volatility")
        ),
        sectorExposureHeatmap: buildSectorExposureHeatmap(portfolioSources),
        allocationBreakdown: buildAllocationBreakdown(portfolioSources),
        alertSeverityTimeline: buildAlertSeverityTimeline(
          filteredSources.flatMap((source) => source.alerts),
          rangeStart
        ),
        reportPipeline: buildReportPipeline(
          filteredSources.flatMap((source) => source.reportPackages),
          rangeStart,
          this.now()
        ),
        workbenchAging: buildWorkbenchAging(filteredReviewItems, this.now()),
        staleDataBacklog: buildStaleDataBacklog(portfolioSources, this.now())
      },
      rankings: {
        needsAttention: buildNeedsAttentionRankings(filteredSources)
      },
      dataQuality: {
        status: resolveDataQualityStatus(filteredSources, portfolioSources, issues),
        issues: uniqueIssues(issues),
        sourceCounts: {
          clients: filteredSources.length,
          households: new Set(filteredSources.map((source) => source.client.householdId).filter(Boolean)).size,
          portfolios: portfolioSources.length,
          analyticsSnapshots,
          reportPackages: reportPackageCount,
          alerts: alertCount,
          reviewItems: filteredReviewItems.length
        }
      }
    };

    this.metrics.increment("advisor.charts.request");
    if (bundle.dataQuality.status !== "fresh") {
      this.metrics.increment("advisor.charts.partial");
    }
    this.logger.info("advisor.charts.generated", {
      officeId,
      actorId: actor.id,
      advisorUserId,
      assignmentScope,
      range: query.range,
      portfolioCount: portfolioSources.length,
      partialChartCount: bundle.dataQuality.issues.length,
      latencyMs: this.now().getTime() - startedAt
    });

    return {
      data: bundle,
      meta: {
        generatedAt: this.now().toISOString(),
        assignmentScope
      }
    };
  }

  private async visibleClientIdsForAdvisor(
    officeId: string,
    advisorUserId: string,
    teamId: string | undefined,
    officeClients: ClientSummary[]
  ): Promise<Set<string>> {
    const assignments = await this.advisory.listAssignmentsForUser(advisorUserId, officeId);
    const allowedAssignments = assignments.filter(
      (assignment) =>
        !teamId || (assignment.teamId === teamId && assignment.permissions.includes("client.read"))
    );
    const visibleClientIds = new Set(
      teamId
        ? []
        : officeClients
            .filter((client) => client.advisorUserId === advisorUserId)
            .map((client) => client.id)
    );

    for (const assignment of allowedAssignments) {
      if (!assignment.permissions.includes("client.read")) {
        continue;
      }

      if (assignment.resourceType === "client") {
        visibleClientIds.add(assignment.resourceId);
      } else if (assignment.resourceType === "household") {
        for (const client of officeClients) {
          if (client.householdId === assignment.resourceId) {
            visibleClientIds.add(client.id);
          }
        }
      } else if (assignment.resourceType === "account") {
        const account = await this.accounts.findAccountById(assignment.resourceId);
        if (account?.officeId === officeId && account.clientId) {
          visibleClientIds.add(account.clientId);
        }
      } else if (assignment.resourceType === "portfolio") {
        const portfolio = await this.portfolios.findPortfolioById(assignment.resourceId);
        if (portfolio?.officeId === officeId && portfolio.clientId) {
          visibleClientIds.add(portfolio.clientId);
        }
      }
    }

    return visibleClientIds;
  }

  private async buildClientSource(
    client: ClientSummary,
    officeReviewItems: ReviewItem[],
    rangeStart: string | undefined,
    issues: DataQualityIssue[]
  ): Promise<ClientChartSource> {
    const detail = await this.clients.findClientById(client.id);
    const portfolioSources = await Promise.all(
      (detail?.portfolios ?? []).map(async (portfolio) => {
        const snapshot = await this.analytics.findLatestSnapshot(portfolio.id);
        if (!snapshot) {
          issues.push({
            code: "advisor_charts.snapshot_missing",
            severity: "warning",
            message: `Portfolio ${portfolio.id} has no completed analytics snapshot.`,
            metricKeys: [
              "annualizedReturn",
              "maxDrawdown",
              "volatility",
              "sharpeRatio",
              "sectorExposure"
            ]
          });
        }
        return { portfolio, client, snapshot };
      })
    );
    const reportPackages = (await this.reportPackages.listReportPackagesByClient(client.id))
      .filter((entry) => isDateInRange(entry.updatedAt.toISOString().slice(0, 10), rangeStart));
    const reviewItems = officeReviewItems.filter((item) => item.clientId === client.id);
    const alerts = (
      await Promise.all(
        portfolioSources.map((source) => this.alerts.listAlertsByPortfolio(source.portfolio.id))
      )
    ).flat();
    const value = round(
      portfolioSources.reduce((sum, source) => sum + source.portfolio.totalCostBasis, 0),
      2
    );
    const riskBand = highestRiskBand(portfolioSources.map((source) => riskBandForPortfolio(source)));
    const freshness = resolveClientFreshness(portfolioSources.map((source) => source.portfolio));

    return {
      client,
      portfolios: portfolioSources,
      reportPackages,
      reviewItems,
      alerts,
      value,
      riskBand,
      freshness,
      maxDrawdownPercent: maxMetric(portfolioSources, "maxDrawdown"),
      volatilityPercent: maxMetric(portfolioSources, "volatility")
    };
  }
}

function assertStaffAdvisorChartAccess(evaluation: PermissionEvaluation): void {
  if (evaluation.role === "client") {
    throw new ApplicationError(
      "forbidden",
      "auth.permission_denied",
      "Advisor charts are restricted to staff users"
    );
  }
}

function resolveAssignmentScope(evaluation: PermissionEvaluation): AdvisorAssignmentScope {
  return evaluation.role === "office_admin" ? "office_admin" : "advisor";
}

function parseClientStatuses(value: string | undefined): ClientStatus[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry): entry is ClientStatus =>
      CLIENT_STATUSES.includes(entry as ClientStatus)
    );
}

function buildBookValueTrend(
  sources: PortfolioChartSource[],
  rangeStart: string | undefined
): AdvisorBookValueTrendPoint[] {
  const byDate = new Map<string, { value: number; clients: Set<string>; portfolios: Set<string> }>();
  for (const source of sources) {
    const performance = source.snapshot?.performance ?? [];
    for (const point of performance) {
      if (!isDateInRange(point.date, rangeStart)) {
        continue;
      }
      const current = byDate.get(point.date) ?? {
        value: 0,
        clients: new Set<string>(),
        portfolios: new Set<string>()
      };
      current.value += point.value;
      if (source.client?.id) {
        current.clients.add(source.client.id);
      }
      current.portfolios.add(source.portfolio.id);
      byDate.set(point.date, current);
    }

    if (performance.length === 0 && source.portfolio.lastTransactionDate) {
      const date = source.portfolio.lastTransactionDate;
      if (isDateInRange(date, rangeStart)) {
        const current = byDate.get(date) ?? {
          value: 0,
          clients: new Set<string>(),
          portfolios: new Set<string>()
        };
        current.value += source.portfolio.totalCostBasis;
        if (source.client?.id) {
          current.clients.add(source.client.id);
        }
        current.portfolios.add(source.portfolio.id);
        byDate.set(date, current);
      }
    }
  }

  return Array.from(byDate.entries())
    .map(([date, entry]) => ({
      date,
      value: round(entry.value, 2),
      clientCount: entry.clients.size,
      portfolioCount: entry.portfolios.size
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function buildRiskReturnPoint(source: PortfolioChartSource): AdvisorRiskReturnPoint {
  const metrics = source.snapshot?.metrics;
  return {
    id: source.portfolio.id,
    clientId: source.client?.id,
    clientName: source.client?.name,
    householdId: source.client?.householdId ?? source.portfolio.householdId,
    householdName: source.client?.householdName ?? source.portfolio.householdName,
    portfolioId: source.portfolio.id,
    portfolioName: source.portfolio.name,
    value: source.portfolio.totalCostBasis,
    annualizedReturnPercent: metricValue(metrics?.annualizedReturn),
    volatilityPercent: metricValue(metrics?.volatility),
    maxDrawdownPercent: metricValue(metrics?.maxDrawdown),
    sharpeRatio: metricValue(metrics?.sharpeRatio),
    riskBand: riskBandForPortfolio(source),
    freshness: source.portfolio.freshness,
    drillDown: {
      clientId: source.client?.id,
      householdId: source.client?.householdId ?? source.portfolio.householdId,
      portfolioId: source.portfolio.id
    }
  };
}

function buildClientRiskDistributionPoint(
  source: ClientChartSource,
  metric: "maxDrawdown" | "volatility"
): AdvisorClientRiskDistributionPoint {
  return {
    clientId: source.client.id,
    clientName: source.client.name,
    householdId: source.client.householdId,
    householdName: source.client.householdName,
    value: metric === "maxDrawdown"
      ? round(source.maxDrawdownPercent ?? 0, 4)
      : round(source.volatilityPercent ?? 0, 4),
    portfolioCount: source.portfolios.length,
    riskBand: source.riskBand,
    freshness: source.freshness,
    drillDown: {
      clientId: source.client.id,
      householdId: source.client.householdId
    }
  };
}

function buildSectorExposureHeatmap(sources: PortfolioChartSource[]): AdvisorSectorHeatmapCell[] {
  const byClientSector = new Map<string, AdvisorSectorHeatmapCell>();
  for (const source of sources) {
    const clientId = source.client?.id ?? source.portfolio.clientId;
    const clientName = source.client?.name ?? source.portfolio.clientName;
    if (!clientId || !clientName) {
      continue;
    }

    for (const exposure of source.snapshot?.sectorExposure ?? fallbackSectorExposure(source)) {
      const key = `${clientId}:${exposure.sector}`;
      const current = byClientSector.get(key) ?? {
        clientId,
        clientName,
        householdId: source.client?.householdId ?? source.portfolio.householdId,
        sector: exposure.sector,
        weightPercent: 0,
        marketValueUsd: 0,
        drillDown: {
          clientId,
          householdId: source.client?.householdId ?? source.portfolio.householdId
        }
      };
      current.marketValueUsd += exposure.marketValueUsd;
      byClientSector.set(key, current);
    }
  }

  const totalsByClient = new Map<string, number>();
  for (const cell of byClientSector.values()) {
    totalsByClient.set(cell.clientId, (totalsByClient.get(cell.clientId) ?? 0) + cell.marketValueUsd);
  }

  return Array.from(byClientSector.values())
    .map((cell) => ({
      ...cell,
      marketValueUsd: round(cell.marketValueUsd, 2),
      weightPercent: round(
        ((cell.marketValueUsd / Math.max(totalsByClient.get(cell.clientId) ?? 0, 1)) * 100),
        2
      )
    }))
    .sort((left, right) => left.clientName.localeCompare(right.clientName) || right.weightPercent - left.weightPercent);
}

function buildAllocationBreakdown(sources: PortfolioChartSource[]): AdvisorAllocationBreakdownPoint[] {
  const allocation = new Map<string, AdvisorAllocationBreakdownPoint>();
  for (const source of sources) {
    const points = source.snapshot?.allocation.length
      ? source.snapshot.allocation
      : [
          {
            symbol: "UNCLASSIFIED",
            name: "Não classificado",
            weightPercent: 100,
            marketValueUsd: source.portfolio.totalCostBasis
          }
        ];
    for (const point of points) {
      const key = point.symbol || point.name;
      const current = allocation.get(key) ?? {
        label: point.name || point.symbol,
        weightPercent: 0,
        marketValueUsd: 0
      };
      current.marketValueUsd += point.marketValueUsd;
      allocation.set(key, current);
    }
  }

  const total = Array.from(allocation.values()).reduce((sum, entry) => sum + entry.marketValueUsd, 0);
  return Array.from(allocation.values())
    .map((entry) => ({
      ...entry,
      marketValueUsd: round(entry.marketValueUsd, 2),
      weightPercent: total > 0 ? round((entry.marketValueUsd / total) * 100, 2) : 0
    }))
    .sort((left, right) => right.weightPercent - left.weightPercent);
}

function buildAlertSeverityTimeline(
  alerts: AlertRule[],
  rangeStart: string | undefined
): AdvisorAlertSeverityTimelinePoint[] {
  const byDate = new Map<string, AdvisorAlertSeverityTimelinePoint>();
  for (const alert of alerts) {
    const date = (alert.lastTriggeredAt ?? alert.updatedAt ?? alert.createdAt).toISOString().slice(0, 10);
    if (!isDateInRange(date, rangeStart)) {
      continue;
    }
    const current = byDate.get(date) ?? { date, low: 0, medium: 0, high: 0, total: 0 };
    current[alert.severity] += 1;
    current.total += 1;
    byDate.set(date, current);
  }
  return Array.from(byDate.values()).sort((left, right) => left.date.localeCompare(right.date));
}

function buildReportPipeline(
  packages: ReportPackage[],
  rangeStart: string | undefined,
  now: Date
): AdvisorReportPipelinePoint[] {
  const byStatus = new Map<string, AdvisorReportPipelinePoint & { clients: Set<string> }>();
  for (const reportPackage of packages) {
    const updatedDate = reportPackage.updatedAt.toISOString().slice(0, 10);
    if (!isDateInRange(updatedDate, rangeStart)) {
      continue;
    }
    const current = byStatus.get(reportPackage.status) ?? {
      status: reportPackage.status,
      count: 0,
      clientCount: 0,
      staleCount: 0,
      clients: new Set<string>(),
      latestUpdatedAt: undefined
    };
    current.count += 1;
    current.clients.add(reportPackage.clientId);
    current.clientCount = current.clients.size;
    if (["draft", "pending_approval", "approved"].includes(reportPackage.status) && ageInDays(reportPackage.updatedAt, now) > 7) {
      current.staleCount += 1;
    }
    current.latestUpdatedAt =
      !current.latestUpdatedAt || reportPackage.updatedAt.toISOString() > current.latestUpdatedAt
        ? reportPackage.updatedAt.toISOString()
        : current.latestUpdatedAt;
    byStatus.set(reportPackage.status, current);
  }

  return Array.from(byStatus.values())
    .map(({ clients: _clients, ...entry }) => entry)
    .sort((left, right) => left.status.localeCompare(right.status));
}

function buildWorkbenchAging(items: ReviewItem[], now: Date): AdvisorWorkbenchAgingPoint[] {
  const buckets: AdvisorWorkbenchAgingPoint[] = [
    { bucket: "overdue", low: 0, medium: 0, high: 0, total: 0 },
    { bucket: "due_7d", low: 0, medium: 0, high: 0, total: 0 },
    { bucket: "due_30d", low: 0, medium: 0, high: 0, total: 0 },
    { bucket: "no_due_date", low: 0, medium: 0, high: 0, total: 0 }
  ];
  const byBucket = new Map(buckets.map((bucket) => [bucket.bucket, bucket]));
  for (const item of items.filter((entry) => entry.status !== "closed")) {
    const bucket = bucketForDueDate(item.dueDate, now);
    const current = byBucket.get(bucket);
    if (!current) {
      continue;
    }
    current[item.severity] += 1;
    current.total += 1;
  }
  return buckets;
}

function buildStaleDataBacklog(
  sources: PortfolioChartSource[],
  now: Date
): AdvisorStaleDataBacklogItem[] {
  return sources
    .filter(
      (source) =>
        source.portfolio.freshness !== "fresh" ||
        source.portfolio.analyticsState !== "ready" ||
        source.portfolio.marketDataState !== "ready" ||
        source.snapshot?.status === "partial"
    )
    .map((source) => ({
      portfolioId: source.portfolio.id,
      portfolioName: source.portfolio.name,
      clientId: source.client?.id,
      clientName: source.client?.name,
      householdId: source.client?.householdId ?? source.portfolio.householdId,
      householdName: source.client?.householdName ?? source.portfolio.householdName,
      freshness: source.portfolio.freshness,
      analyticsState: source.portfolio.analyticsState,
      marketDataState: source.portfolio.marketDataState,
      reason: staleReason(source),
      daysSinceLastTransaction: source.portfolio.lastTransactionDate
        ? daysBetween(`${source.portfolio.lastTransactionDate}T00:00:00.000Z`, now)
        : undefined,
      drillDown: {
        clientId: source.client?.id,
        householdId: source.client?.householdId ?? source.portfolio.householdId,
        portfolioId: source.portfolio.id
      }
    }))
    .sort((left, right) => {
      const freshnessRank = freshnessWeight(right.freshness) - freshnessWeight(left.freshness);
      return freshnessRank || (right.daysSinceLastTransaction ?? 0) - (left.daysSinceLastTransaction ?? 0);
    });
}

function buildNeedsAttentionRankings(sources: ClientChartSource[]): AdvisorNeedsAttentionItem[] {
  return sources
    .map((source) => {
      const openReviewItemCount = source.reviewItems.filter((item) => item.status !== "closed").length;
      const highAlertCount = source.alerts.filter((alert) => alert.severity === "high" && alert.status !== "disabled").length;
      const pendingReportCount = source.reportPackages.filter((entry) =>
        ["draft", "pending_approval", "approved"].includes(entry.status)
      ).length;
      const reasons: string[] = [];
      let score = 0;
      if (source.portfolios.length > 0) {
        if (source.riskBand === "high") {
          score += 45;
          reasons.push("Risco agregado em faixa alta");
        } else if (source.riskBand === "watch") {
          score += 25;
          reasons.push("Métricas em faixa de observação");
        }
        if (source.freshness === "stale") {
          score += 30;
          reasons.push("Dados defasados");
        } else if (source.freshness === "partial") {
          score += 15;
          reasons.push("Dados parciais");
        }
      }
      if (highAlertCount > 0) {
        score += highAlertCount * 20;
        reasons.push("Alertas de severidade alta");
      }
      if (openReviewItemCount > 0) {
        score += openReviewItemCount * 10;
        reasons.push("Itens de acompanhamento em aberto");
      }
      if (pendingReportCount > 0) {
        score += pendingReportCount * 8;
        reasons.push("Pacotes de relatório em andamento");
      }

      return {
        rank: 0,
        clientId: source.client.id,
        clientName: source.client.name,
        householdId: source.client.householdId,
        householdName: source.client.householdName,
        score,
        reasons,
        value: source.value,
        riskBand: source.riskBand,
        freshness: source.freshness,
        openReviewItemCount,
        highAlertCount,
        pendingReportCount,
        drillDown: {
          clientId: source.client.id,
          householdId: source.client.householdId
        }
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.value - left.value)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function riskBandForPortfolio(source: PortfolioChartSource): AdvisorRiskBand {
  const metrics = source.snapshot?.metrics;
  const drawdown = metricValue(metrics?.maxDrawdown);
  const volatility = metricValue(metrics?.volatility);
  const concentration = metricValue(metrics?.concentrationHhi);
  if (
    source.portfolio.freshness === "stale" ||
    (drawdown !== undefined && Math.abs(drawdown) >= 15) ||
    (volatility !== undefined && volatility >= 20) ||
    (concentration !== undefined && concentration >= 0.35)
  ) {
    return "high";
  }
  if (
    source.portfolio.freshness === "partial" ||
    source.portfolio.analyticsState !== "ready" ||
    source.portfolio.marketDataState !== "ready" ||
    (drawdown !== undefined && Math.abs(drawdown) >= 8) ||
    (volatility !== undefined && volatility >= 10) ||
    (concentration !== undefined && concentration >= 0.2)
  ) {
    return "watch";
  }
  return "low";
}

function resolveClientFreshness(portfolios: PortfolioSummary[]): AdvisorFreshness {
  if (portfolios.some((portfolio) => portfolio.freshness === "stale")) {
    return "stale";
  }
  if (
    portfolios.length === 0 ||
    portfolios.some(
      (portfolio) =>
        portfolio.freshness === "partial" ||
        portfolio.analyticsState !== "ready" ||
        portfolio.marketDataState !== "ready"
    )
  ) {
    return "partial";
  }
  return "fresh";
}

function highestRiskBand(bands: AdvisorRiskBand[]): AdvisorRiskBand {
  if (bands.includes("high")) {
    return "high";
  }
  if (bands.length === 0 || bands.includes("watch")) {
    return "watch";
  }
  return "low";
}

function maxMetric(
  sources: PortfolioChartSource[],
  key: "maxDrawdown" | "volatility"
): number | undefined {
  const values = sources
    .map((source) => metricValue(source.snapshot?.metrics[key]))
    .filter((value): value is number => value !== undefined)
    .map((value) => Math.abs(value));
  return values.length > 0 ? Math.max(...values) : undefined;
}

function metricValue(metric: { value?: number; status?: string } | undefined): number | undefined {
  return metric?.status === "available" ? metric.value : undefined;
}

function fallbackSectorExposure(source: PortfolioChartSource): SectorExposurePoint[] {
  return [
    {
      sector: "Não classificado",
      weightPercent: 100,
      marketValueUsd: source.portfolio.totalCostBasis
    }
  ];
}

function matchesRiskAndFreshness(
  source: ClientChartSource,
  riskBand: AdvisorRiskBand | undefined,
  freshness: AdvisorFreshness | undefined
): boolean {
  return (!riskBand || source.riskBand === riskBand) && (!freshness || source.freshness === freshness);
}

function resolveDataQualityStatus(
  clientSources: ClientChartSource[],
  portfolioSources: PortfolioChartSource[],
  issues: DataQualityIssue[]
): AdvisorChartDataQualityStatus {
  if (clientSources.length === 0) {
    return "empty";
  }
  if (portfolioSources.some((source) => source.portfolio.freshness === "stale")) {
    return "stale";
  }
  if (
    issues.length > 0 ||
    portfolioSources.some(
      (source) =>
        !source.snapshot ||
        source.snapshot.status === "partial" ||
        source.portfolio.freshness === "partial" ||
        source.portfolio.analyticsState !== "ready" ||
        source.portfolio.marketDataState !== "ready"
    )
  ) {
    return "partial";
  }
  return "fresh";
}

function uniqueIssues(issues: DataQualityIssue[]): DataQualityIssue[] {
  const seen = new Set<string>();
  const result: DataQualityIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.code}:${issue.message}:${(issue.symbols ?? []).join(",")}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(issue);
    }
  }
  return result;
}

function staleReason(source: PortfolioChartSource): string {
  if (source.portfolio.marketDataState !== "ready") {
    return "Atualização de dados de mercado pendente";
  }
  if (source.portfolio.analyticsState !== "ready" || !source.snapshot) {
    return "Retrato analítico pendente";
  }
  if (source.snapshot.status === "partial") {
    return "Retrato analítico parcial";
  }
  return "Carteira com frescor parcial";
}

function buildWorkbenchBucketName(bucket: AdvisorWorkbenchAgingPoint["bucket"]) {
  return bucket;
}

function bucketForDueDate(
  dueDate: string | undefined,
  now: Date
): AdvisorWorkbenchAgingPoint["bucket"] {
  if (!dueDate) {
    return buildWorkbenchBucketName("no_due_date");
  }
  const diff = daysBetween(`${dueDate}T00:00:00.000Z`, now);
  if (diff < 0) {
    return buildWorkbenchBucketName("overdue");
  }
  if (diff <= 7) {
    return buildWorkbenchBucketName("due_7d");
  }
  return buildWorkbenchBucketName("due_30d");
}

function startDateForRange(range: AdvisorChartsQuery["range"], now: Date): string | undefined {
  if (range === "all") {
    return undefined;
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (range === "ytd") {
    start.setUTCMonth(0, 1);
  } else if (range === "30d") {
    start.setUTCDate(start.getUTCDate() - 30);
  } else if (range === "90d") {
    start.setUTCDate(start.getUTCDate() - 90);
  } else if (range === "1y") {
    start.setUTCFullYear(start.getUTCFullYear() - 1);
  }
  return start.toISOString().slice(0, 10);
}

function isDateInRange(date: string, rangeStart: string | undefined): boolean {
  return !rangeStart || date >= rangeStart;
}

function ageInDays(date: Date, now: Date): number {
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000);
}

function daysBetween(dateIso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(dateIso).getTime()) / 86_400_000);
}

function freshnessWeight(freshness: AdvisorFreshness): number {
  return freshness === "stale" ? 3 : freshness === "partial" ? 2 : 1;
}
