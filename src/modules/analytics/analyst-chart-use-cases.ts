import { createHash, randomUUID } from "crypto";
import { Actor } from "../../01-domain/auth/actor";
import { PortfolioSummary } from "../../01-domain/portfolios/portfolio";
import { PermissionEvaluation, PermissionService } from "../../02-application/auth/permission-service";
import { ApplicationError } from "../../02-application/errors/application-error";
import { LoggerPort, MetricsPort } from "../../02-application/ports/observability";
import { AdvisoryTeamRepository, ClientRepository, PortfolioRepository } from "../../02-application/ports/repositories";
import { MarketDataRepository } from "../market-data/ports";
import { calculatePeriodicReturns, calculateVolatility, round } from "./formulas";
import { AnalyticsEventPublisher, AnalyticsRepository } from "./ports";
import { AnalyticsJob, AnalyticsMetric, AnalyticsMetricKey, DataQualityIssue, PortfolioAnalyticsSnapshot } from "./types";
import {
  AnalystBenchmarkSensitivityPoint,
  AnalystChartBundle,
  AnalystChartDataQualityStatus,
  AnalystChartJob,
  AnalystChartJobRepository,
  AnalystChartsQuery,
  AnalystChartsResponse,
  AnalystConcentrationRankingItem,
  AnalystCorrelationPoint,
  AnalystDataQualityFilter,
  AnalystDataQualityTimelinePoint,
  AnalystExposureHeatmapCell,
  AnalystMetricDistribution,
  AnalystMetricDistributionBucket,
  AnalystPortfolioReference,
  AnalystProviderFreshnessCell,
  AnalystRiskContributionPoint,
  AnalystRiskReturnPoint,
  AnalystRollingPoint
} from "./analyst-chart-types";

const DEFAULT_METRICS: AnalyticsMetricKey[] = [
  "volatility",
  "beta",
  "sharpeRatio",
  "maxDrawdown",
  "concentrationHhi",
  "assetCorrelation"
];

const CHART_KEYS = [
  "riskReturnScatter",
  "metricDistributions",
  "rollingVolatility",
  "rollingCorrelation",
  "sectorExposureHeatmap",
  "assetExposureHeatmap",
  "benchmarkSensitivity",
  "riskContribution",
  "concentrationRanking",
  "dataQualityTimeline",
  "providerFreshnessMatrix"
];

interface AnalystPortfolioSource {
  portfolio: PortfolioSummary;
  reference: AnalystPortfolioReference;
  snapshot?: PortfolioAnalyticsSnapshot;
  latestJob?: AnalyticsJob;
}

export class GetAnalystChartsUseCase {
  constructor(
    private readonly portfolios: PortfolioRepository,
    private readonly clients: ClientRepository,
    private readonly advisory: AdvisoryTeamRepository,
    private readonly analytics: AnalyticsRepository,
    private readonly marketData: MarketDataRepository,
    private readonly permissions: PermissionService,
    private readonly logger: LoggerPort,
    private readonly metrics: MetricsPort,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    actor: Actor,
    officeId: string,
    query: AnalystChartsQuery
  ): Promise<AnalystChartsResponse> {
    const startedAt = this.now().getTime();
    const evaluation = await this.permissions.evaluate(actor, officeId);
    assertAnalystDiagnosticsAccess(actor, evaluation);
    const selectedMetrics = parseMetrics(query.metrics);
    const selectedPortfolioIds = parseList(query.portfolioIds);
    const rangeStart = startDateForRange(query.range, this.now());
    const issues: DataQualityIssue[] = [];
    const unavailableChartKeys = new Set<string>();
    const portfolioSources = await this.resolvePortfolioSources(actor, officeId, query, selectedPortfolioIds);

    if (selectedPortfolioIds.length > 0) {
      const visibleIds = new Set(portfolioSources.map((source) => source.portfolio.id));
      const missingOrDenied = selectedPortfolioIds.filter((portfolioId) => !visibleIds.has(portfolioId));
      if (missingOrDenied.length > 0) {
        this.metrics.increment("analytics.charts.analyst.denied");
        throw new ApplicationError(
          "forbidden",
          "auth.analyst_chart_scope_denied",
          "Analyst chart scope denied"
        );
      }
    }

    const filteredSources = portfolioSources.filter((source) =>
      matchesDataQualityFilter(source, query.dataQuality)
    );
    const benchmarkSensitivity = await this.buildBenchmarkSensitivity(
      filteredSources,
      query.benchmarkSymbol,
      rangeStart,
      issues,
      unavailableChartKeys
    );
    const providerFreshnessMatrix = await this.buildProviderFreshnessMatrix(filteredSources);
    const sourceSnapshotIds = filteredSources
      .map((source) => source.snapshot?.id)
      .filter((value): value is string => Boolean(value));
    const inputHashes = filteredSources
      .map((source) => source.snapshot?.inputHash)
      .filter((value): value is string => Boolean(value));

    const bundle: AnalystChartBundle = {
      officeId,
      range: query.range,
      filters: {
        portfolioIds: selectedPortfolioIds,
        clientId: query.clientId,
        householdId: query.householdId,
        accountId: query.accountId,
        advisorUserId: query.advisorUserId,
        teamId: query.teamId,
        metrics: selectedMetrics,
        benchmarkSymbol: query.benchmarkSymbol?.trim().toUpperCase() || undefined,
        dataQuality: query.dataQuality
      },
      charts: {
        riskReturnScatter: filteredSources.map(buildRiskReturnPoint),
        metricDistributions: buildMetricDistributions(filteredSources, selectedMetrics, issues, unavailableChartKeys),
        rollingVolatility: buildRollingVolatility(filteredSources, rangeStart, unavailableChartKeys),
        rollingCorrelation: buildRollingCorrelation(filteredSources, rangeStart, unavailableChartKeys),
        sectorExposureHeatmap: buildSectorExposureHeatmap(filteredSources, unavailableChartKeys),
        assetExposureHeatmap: buildAssetExposureHeatmap(filteredSources, unavailableChartKeys),
        benchmarkSensitivity,
        riskContribution: buildRiskContribution(filteredSources, unavailableChartKeys),
        concentrationRanking: buildConcentrationRanking(filteredSources, unavailableChartKeys),
        dataQualityTimeline: buildDataQualityTimeline(filteredSources),
        providerFreshnessMatrix
      },
      dataQuality: {
        status: resolveDataQualityStatus(filteredSources, issues),
        issues: uniqueIssues(issues),
        unavailableChartKeys: Array.from(unavailableChartKeys).sort((left, right) =>
          left.localeCompare(right)
        ),
        sourceCounts: {
          portfolios: filteredSources.length,
          snapshots: sourceSnapshotIds.length,
          analyticsJobs: filteredSources.filter((source) => source.latestJob).length,
          assets: new Set(providerFreshnessMatrix.map((entry) => entry.symbol)).size
        }
      }
    };

    this.metrics.increment("analytics.charts.analyst.request");
    this.metrics.increment("analytics.charts.analyst.portfolios", filteredSources.length);
    if (bundle.dataQuality.status !== "complete") {
      this.metrics.increment("analytics.charts.analyst.partial");
    }
    this.logger.info("analytics.charts.analyst.generated", {
      actorId: actor.id,
      officeId,
      range: query.range,
      portfolioCount: filteredSources.length,
      metricCount: selectedMetrics.length,
      partialChartCount: bundle.dataQuality.unavailableChartKeys.length,
      latencyMs: this.now().getTime() - startedAt
    });

    return {
      data: bundle,
      meta: {
        generatedAt: this.now().toISOString(),
        sourceSnapshotIds,
        inputHashes,
        calculationDurationMs: this.now().getTime() - startedAt
      }
    };
  }

  private async resolvePortfolioSources(
    actor: Actor,
    officeId: string,
    query: AnalystChartsQuery,
    selectedPortfolioIds: string[]
  ): Promise<AnalystPortfolioSource[]> {
    const clients = await this.clients.listClients(officeId, {});
    const clientById = new Map(clients.map((client) => [client.id, client]));
    const teamScopedResourceIds = query.teamId
      ? await this.teamScopedResourceIds(officeId, query.teamId)
      : undefined;

    const summaries = (await this.portfolios.listVisiblePortfolios(actor.id, actor.role === "admin"))
      .filter((portfolio) => portfolio.officeId === officeId)
      .filter((portfolio) => selectedPortfolioIds.length === 0 || selectedPortfolioIds.includes(portfolio.id))
      .filter((portfolio) => !query.clientId || portfolio.clientId === query.clientId)
      .filter((portfolio) => !query.householdId || portfolio.householdId === query.householdId)
      .filter((portfolio) => !query.accountId || portfolio.accountId === query.accountId)
      .filter((portfolio) => {
        if (!query.advisorUserId) {
          return true;
        }
        const client = portfolio.clientId ? clientById.get(portfolio.clientId) : undefined;
        return client?.advisorUserId === query.advisorUserId;
      })
      .filter((portfolio) => {
        if (!teamScopedResourceIds) {
          return true;
        }
        return (
          teamScopedResourceIds.portfolioIds.has(portfolio.id) ||
          teamScopedResourceIds.accountIds.has(portfolio.accountId) ||
          (portfolio.clientId ? teamScopedResourceIds.clientIds.has(portfolio.clientId) : false) ||
          (portfolio.householdId ? teamScopedResourceIds.householdIds.has(portfolio.householdId) : false)
        );
      });

    return Promise.all(
      summaries.map(async (portfolio) => ({
        portfolio,
        reference: buildReference(portfolio),
        snapshot: await this.analytics.findLatestSnapshot(portfolio.id),
        latestJob: await this.analytics.findLatestJob(portfolio.id)
      }))
    );
  }

  private async teamScopedResourceIds(officeId: string, teamId: string) {
    const assignments = (await this.advisory.listAssignmentsByOffice(officeId)).filter(
      (assignment) => !assignment.revokedAt && assignment.teamId === teamId
    );
    return {
      portfolioIds: new Set(assignments.filter((entry) => entry.resourceType === "portfolio").map((entry) => entry.resourceId)),
      accountIds: new Set(assignments.filter((entry) => entry.resourceType === "account").map((entry) => entry.resourceId)),
      clientIds: new Set(assignments.filter((entry) => entry.resourceType === "client").map((entry) => entry.resourceId)),
      householdIds: new Set(assignments.filter((entry) => entry.resourceType === "household").map((entry) => entry.resourceId))
    };
  }

  private async buildBenchmarkSensitivity(
    sources: AnalystPortfolioSource[],
    benchmarkSymbol: string | undefined,
    rangeStart: string | undefined,
    issues: DataQualityIssue[],
    unavailableChartKeys: Set<string>
  ): Promise<AnalystBenchmarkSensitivityPoint[]> {
    const symbol = benchmarkSymbol?.trim().toUpperCase();
    if (!symbol) {
      return [];
    }

    const asset = await this.marketData.findAssetBySymbol(symbol);
    if (!asset) {
      issues.push({
        code: "analyst_charts.benchmark_unavailable",
        severity: "warning",
        message: `Benchmark ${symbol} is unavailable in stored backend market data.`,
        symbols: [symbol]
      });
      unavailableChartKeys.add("benchmarkSensitivity");
      return sources.map((source) => ({
        ...source.reference,
        benchmarkSymbol: symbol,
        unavailableReason: "benchmark_unavailable"
      }));
    }

    const history = (await this.marketData.listHistoricalPrices(asset.id))
      .filter((price) => !rangeStart || price.date >= rangeStart)
      .sort((left, right) => left.date.localeCompare(right.date));
    if (history.length < 2) {
      issues.push({
        code: "analyst_charts.benchmark_history_insufficient",
        severity: "warning",
        message: `Benchmark ${symbol} does not have enough stored history for sensitivity.`,
        symbols: [symbol]
      });
      unavailableChartKeys.add("benchmarkSensitivity");
    }

    const first = history[0]?.adjustedClose || history[0]?.close;
    const last = history[history.length - 1]?.adjustedClose || history[history.length - 1]?.close;
    const benchmarkReturn = first && last ? last / first - 1 : undefined;
    return sources.map((source) => {
      const portfolioReturn = metricValue(source.snapshot?.metrics.totalReturn);
      return {
        ...source.reference,
        benchmarkSymbol: symbol,
        portfolioReturnPercent: toPercent(portfolioReturn),
        benchmarkReturnPercent: toPercent(benchmarkReturn),
        beta: metricValue(source.snapshot?.metrics.beta),
        sensitivity:
          portfolioReturn !== undefined && benchmarkReturn !== undefined && benchmarkReturn !== 0
            ? round(portfolioReturn / benchmarkReturn, 4)
            : undefined,
        unavailableReason:
          portfolioReturn === undefined || benchmarkReturn === undefined
            ? "insufficient_aligned_history"
            : undefined
      };
    });
  }

  private async buildProviderFreshnessMatrix(
    sources: AnalystPortfolioSource[]
  ): Promise<AnalystProviderFreshnessCell[]> {
    const cells: AnalystProviderFreshnessCell[] = [];
    for (const source of sources) {
      const symbols = Array.from(
        new Set([
          ...(source.snapshot?.positions.map((position) => position.assetSymbol) ?? []),
          ...(source.snapshot?.allocation.map((point) => point.symbol) ?? [])
        ])
      ).filter((symbol) => symbol && symbol !== "UNCLASSIFIED");
      for (const symbol of symbols) {
        const asset = await this.marketData.findAssetBySymbol(symbol);
        const quote = asset ? await this.marketData.findLatestQuote(asset.id) : undefined;
        cells.push({
          ...source.reference,
          symbol,
          providerName: quote?.providerName ?? asset?.providerName,
          freshness: quote?.freshness ?? "missing",
          asOf: quote?.asOf.toISOString(),
          issueCode: quote ? undefined : "market_data.quote_unavailable"
        });
      }
    }
    return cells.sort((left, right) => left.portfolioName.localeCompare(right.portfolioName) || left.symbol.localeCompare(right.symbol));
  }
}

export class CreateAnalystChartJobUseCase {
  constructor(
    private readonly portfolios: PortfolioRepository,
    private readonly jobs: AnalystChartJobRepository,
    private readonly permissions: PermissionService,
    private readonly events: AnalyticsEventPublisher,
    private readonly metrics: MetricsPort,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    actor: Actor,
    officeId: string,
    query: AnalystChartsQuery,
    idempotencyKey: string | undefined,
    correlationId: string = randomUUID()
  ): Promise<AnalystChartJob> {
    const evaluation = await this.permissions.evaluate(actor, officeId);
    assertAnalystDiagnosticsAccess(actor, evaluation);
    if (!idempotencyKey) {
      throw new ApplicationError(
        "invalid",
        "request.idempotency_key_required",
        "Idempotency-Key header is required"
      );
    }
    const requestedPortfolioCount = await this.assertRequestedPortfolioScope(actor, officeId, query);

    const existing = await this.jobs.findJobByIdempotencyKey(officeId, actor.id, idempotencyKey);
    if (existing) {
      return existing;
    }

    const createdAt = this.now();
    const job = await this.jobs.createJob({
      id: randomUUID(),
      officeId,
      requestedBy: actor.id,
      idempotencyKey,
      filters: query,
      inputHash: stableHash({ officeId, query }),
      correlationId,
      status: "pending",
      progressPercent: 0,
      sourceSnapshotIds: [],
      resultMetadata: {
        portfolioCount: requestedPortfolioCount,
        chartKeys: CHART_KEYS
      },
      createdAt,
      updatedAt: createdAt,
      expiresAt: new Date(createdAt.getTime() + 7 * 86_400_000)
    });

    await this.events.publish("AnalystChartJobRequested", job.id, {
      officeId,
      jobId: job.id,
      requestedBy: actor.id,
      correlationId
    });
    this.metrics.increment("analytics.charts.analyst.job.requested");
    return job;
  }

  private async assertRequestedPortfolioScope(
    actor: Actor,
    officeId: string,
    query: AnalystChartsQuery
  ): Promise<number> {
    const selectedPortfolioIds = parseList(query.portfolioIds);
    const visibleOfficePortfolios = (await this.portfolios.listVisiblePortfolios(actor.id, actor.role === "admin"))
      .filter((portfolio) => portfolio.officeId === officeId);

    if (selectedPortfolioIds.length === 0) {
      return visibleOfficePortfolios.length;
    }

    const visibleIds = new Set(visibleOfficePortfolios.map((portfolio) => portfolio.id));
    const missingOrDenied = selectedPortfolioIds.filter((portfolioId) => !visibleIds.has(portfolioId));
    if (missingOrDenied.length > 0) {
      this.metrics.increment("analytics.charts.analyst.denied");
      throw new ApplicationError(
        "forbidden",
        "auth.analyst_chart_scope_denied",
        "Analyst chart scope denied"
      );
    }

    return selectedPortfolioIds.length;
  }
}

export class GetAnalystChartJobUseCase {
  constructor(
    private readonly jobs: AnalystChartJobRepository,
    private readonly permissions: PermissionService,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(actor: Actor, officeId: string, jobId: string): Promise<AnalystChartJob> {
    const evaluation = await this.permissions.evaluate(actor, officeId);
    assertAnalystDiagnosticsAccess(actor, evaluation);
    const job = await this.jobs.findJobById(jobId);
    if (!job || job.officeId !== officeId) {
      throw new ApplicationError("not_found", "analyst_chart_job.not_found", "Analyst chart job not found");
    }
    if (job.expiresAt && job.expiresAt.getTime() < this.now().getTime() && job.status !== "expired") {
      return { ...job, status: "expired" };
    }
    return job;
  }
}

function assertAnalystDiagnosticsAccess(actor: Actor, evaluation: PermissionEvaluation): void {
  if (actor.role === "admin" || actor.role === "analyst" || evaluation.role === "office_admin" || evaluation.role === "analyst") {
    return;
  }
  throw new ApplicationError(
    "forbidden",
    "auth.permission_denied",
    "Analyst diagnostics are restricted"
  );
}

function buildRiskReturnPoint(source: AnalystPortfolioSource): AnalystRiskReturnPoint {
  const metrics = source.snapshot?.metrics;
  return {
    ...source.reference,
    valueUsd: source.portfolio.totalCostBasis,
    annualizedReturnPercent: toPercent(metricValue(metrics?.annualizedReturn)),
    volatilityPercent: toPercent(metricValue(metrics?.volatility)),
    maxDrawdownPercent: toPercent(metricValue(metrics?.maxDrawdown)),
    beta: metricValue(metrics?.beta),
    sharpeRatio: metricValue(metrics?.sharpeRatio),
    concentrationHhi: metricValue(metrics?.concentrationHhi),
    dataQualityStatus: sourceQualityStatus(source)
  };
}

function buildMetricDistributions(
  sources: AnalystPortfolioSource[],
  metricKeys: AnalyticsMetricKey[],
  issues: DataQualityIssue[],
  unavailableChartKeys: Set<string>
): AnalystMetricDistribution[] {
  return metricKeys.map((metricKey) => {
    const available = sources
      .map((source) => {
        const metric = source.snapshot?.metrics[metricKey];
        return {
          source,
          metric,
          value: metricValue(metric)
        };
      })
      .filter((entry): entry is { source: AnalystPortfolioSource; metric: AnalyticsMetric; value: number } => entry.value !== undefined);
    const unavailable = sources.filter((source) => metricValue(source.snapshot?.metrics[metricKey]) === undefined);
    if (available.length === 0 && sources.length > 0) {
      issues.push({
        code: "analyst_charts.metric_unavailable",
        severity: "warning",
        message: `Metric ${metricKey} is unavailable for the selected portfolios.`,
        metricKeys: [metricKey]
      });
      unavailableChartKeys.add("metricDistributions");
    }

    return {
      metricKey,
      unit: metricUnit(metricKey),
      buckets: [
        ...histogramBuckets(available.map((entry) => ({
          portfolioId: entry.source.portfolio.id,
          value: metricUnit(metricKey) === "percent" ? entry.value * 100 : entry.value
        }))),
        ...unavailable.map((source) => ({
          label: "indisponivel",
          count: 1,
          portfolioIds: [source.portfolio.id],
          unavailableReason:
            source.snapshot?.metrics[metricKey]?.reason ?? "snapshot_unavailable"
        }))
      ]
    };
  });
}

function buildRollingVolatility(
  sources: AnalystPortfolioSource[],
  rangeStart: string | undefined,
  unavailableChartKeys: Set<string>
): AnalystRollingPoint[] {
  const points: AnalystRollingPoint[] = [];
  for (const source of sources) {
    const performance = (source.snapshot?.performance ?? [])
      .filter((point) => !rangeStart || point.date >= rangeStart)
      .sort((left, right) => left.date.localeCompare(right.date));
    const returns = calculatePeriodicReturns(performance.map((point) => point.value));
    for (let index = 1; index < returns.length; index += 1) {
      const window = returns.slice(Math.max(0, index - 2), index + 1);
      const volatility = calculateVolatility(window);
      const currentPoint = performance[index + 1];
      if (volatility !== undefined && currentPoint) {
        points.push({
          ...source.reference,
          date: currentPoint.date,
          value: round(volatility * 100, 4),
          sampleSize: window.length
        });
      }
    }
  }
  if (points.length === 0 && sources.length > 0) {
    unavailableChartKeys.add("rollingVolatility");
  }
  return points.sort((left, right) => left.date.localeCompare(right.date));
}

function buildRollingCorrelation(
  sources: AnalystPortfolioSource[],
  rangeStart: string | undefined,
  unavailableChartKeys: Set<string>
): AnalystCorrelationPoint[] {
  const points = sources.flatMap((source) =>
    (source.snapshot?.correlation ?? []).map((cell) => ({
      ...source.reference,
      date: source.snapshot?.asOfDate ?? "",
      leftSymbol: cell.leftSymbol,
      rightSymbol: cell.rightSymbol,
      correlation: cell.correlation
    }))
  ).filter((point) => point.date && (!rangeStart || point.date >= rangeStart));
  if (points.length === 0 && sources.length > 0) {
    unavailableChartKeys.add("rollingCorrelation");
  }
  return points.sort((left, right) => left.date.localeCompare(right.date));
}

function buildSectorExposureHeatmap(
  sources: AnalystPortfolioSource[],
  unavailableChartKeys: Set<string>
): AnalystExposureHeatmapCell[] {
  const cells = sources.flatMap((source) =>
    (source.snapshot?.sectorExposure ?? []).map((point) => ({
      ...source.reference,
      label: point.sector,
      weightPercent: point.weightPercent,
      marketValueUsd: point.marketValueUsd
    }))
  );
  if (cells.length === 0 && sources.length > 0) {
    unavailableChartKeys.add("sectorExposureHeatmap");
  }
  return cells.sort((left, right) => right.weightPercent - left.weightPercent);
}

function buildAssetExposureHeatmap(
  sources: AnalystPortfolioSource[],
  unavailableChartKeys: Set<string>
): AnalystExposureHeatmapCell[] {
  const cells = sources.flatMap((source) =>
    (source.snapshot?.allocation ?? []).map((point) => ({
      ...source.reference,
      label: point.symbol || point.name,
      weightPercent: point.weightPercent,
      marketValueUsd: point.marketValueUsd
    }))
  );
  if (cells.length === 0 && sources.length > 0) {
    unavailableChartKeys.add("assetExposureHeatmap");
  }
  return cells.sort((left, right) => right.weightPercent - left.weightPercent);
}

function buildRiskContribution(
  sources: AnalystPortfolioSource[],
  unavailableChartKeys: Set<string>
): AnalystRiskContributionPoint[] {
  const points = sources.flatMap((source) => {
    const volatility = metricValue(source.snapshot?.metrics.volatility);
    return (source.snapshot?.allocation ?? []).map((allocation) => ({
      ...source.reference,
      label: allocation.symbol || allocation.name,
      weightPercent: allocation.weightPercent,
      riskContributionPercent:
        volatility !== undefined ? round(allocation.weightPercent * volatility, 4) : undefined,
      unavailableReason: volatility === undefined ? "volatility_unavailable" : undefined
    }));
  });
  if (points.length === 0 && sources.length > 0) {
    unavailableChartKeys.add("riskContribution");
  }
  return points.sort((left, right) => (right.riskContributionPercent ?? 0) - (left.riskContributionPercent ?? 0));
}

function buildConcentrationRanking(
  sources: AnalystPortfolioSource[],
  unavailableChartKeys: Set<string>
): AnalystConcentrationRankingItem[] {
  const rows = sources.map((source) => {
    const topHolding = [...(source.snapshot?.allocation ?? [])].sort(
      (left, right) => right.weightPercent - left.weightPercent
    )[0];
    return {
      ...source.reference,
      rank: 0,
      concentrationHhi: metricValue(source.snapshot?.metrics.concentrationHhi),
      topHoldingLabel: topHolding?.symbol || topHolding?.name,
      topHoldingWeightPercent: topHolding?.weightPercent,
      unavailableReason: source.snapshot ? undefined : "snapshot_unavailable"
    };
  });
  if (rows.length === 0 && sources.length > 0) {
    unavailableChartKeys.add("concentrationRanking");
  }
  return rows
    .sort(
      (left, right) =>
        (right.concentrationHhi ?? 0) - (left.concentrationHhi ?? 0) ||
        (right.topHoldingWeightPercent ?? 0) - (left.topHoldingWeightPercent ?? 0)
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function buildDataQualityTimeline(sources: AnalystPortfolioSource[]): AnalystDataQualityTimelinePoint[] {
  const points: AnalystDataQualityTimelinePoint[] = [];
  for (const source of sources) {
    if (!source.snapshot) {
      points.push({
        ...source.reference,
        date: source.latestJob?.updatedAt.toISOString().slice(0, 10) ?? "",
        status: source.latestJob?.status === "failed" ? "failed" : "partial",
        issueCode: source.latestJob?.errorCode ?? "analytics.snapshot_unavailable",
        severity: "warning",
        message: source.latestJob?.errorCode ?? "Analytics snapshot unavailable."
      });
      continue;
    }

    if (source.snapshot.dataQuality.issues.length === 0) {
      points.push({
        ...source.reference,
        date: source.snapshot.generatedAt.toISOString().slice(0, 10),
        status: source.snapshot.status
      });
      continue;
    }

    for (const issue of source.snapshot.dataQuality.issues) {
      points.push({
          ...source.reference,
          date: source.snapshot.generatedAt.toISOString().slice(0, 10),
          status: source.snapshot.status,
          issueCode: issue.code,
          severity: issue.severity,
          message: issue.message
      });
    }
  }

  return points.filter((point) => point.date.length > 0);
}

function histogramBuckets(values: Array<{ portfolioId: string; value: number }>): AnalystMetricDistributionBucket[] {
  if (values.length === 0) {
    return [];
  }
  const min = Math.min(...values.map((entry) => entry.value));
  const max = Math.max(...values.map((entry) => entry.value));
  if (min === max) {
    return [{ label: formatRangeLabel(min, max), min, max, count: values.length, portfolioIds: values.map((entry) => entry.portfolioId) }];
  }
  const bucketCount = Math.min(4, values.length);
  const step = (max - min) / bucketCount;
  return Array.from({ length: bucketCount }).map((_, index) => {
    const start = min + step * index;
    const end = index === bucketCount - 1 ? max : start + step;
    const inBucket = values.filter((entry) =>
      index === bucketCount - 1 ? entry.value >= start && entry.value <= end : entry.value >= start && entry.value < end
    );
    return {
      label: formatRangeLabel(start, end),
      min: round(start, 4),
      max: round(end, 4),
      count: inBucket.length,
      portfolioIds: inBucket.map((entry) => entry.portfolioId)
    };
  });
}

function buildReference(portfolio: PortfolioSummary): AnalystPortfolioReference {
  return {
    portfolioId: portfolio.id,
    portfolioName: portfolio.name,
    accountId: portfolio.accountId,
    accountName: portfolio.accountName,
    clientId: portfolio.clientId,
    clientName: portfolio.clientName,
    householdId: portfolio.householdId,
    householdName: portfolio.householdName
  };
}

function parseMetrics(value: string | undefined): AnalyticsMetricKey[] {
  const requested = parseList(value).filter((entry): entry is AnalyticsMetricKey =>
    DEFAULT_METRICS.concat(["totalReturn", "annualizedReturn", "sectorExposure"]).includes(entry as AnalyticsMetricKey)
  );
  return requested.length > 0 ? requested : DEFAULT_METRICS;
}

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function matchesDataQualityFilter(
  source: AnalystPortfolioSource,
  filter: AnalystDataQualityFilter | undefined
): boolean {
  return !filter || sourceQualityStatus(source) === filter;
}

function sourceQualityStatus(source: AnalystPortfolioSource): AnalystChartDataQualityStatus {
  if (source.latestJob?.status === "failed") {
    return "failed";
  }
  if (source.portfolio.freshness === "stale") {
    return "stale";
  }
  if (!source.snapshot || source.snapshot.status === "partial" || source.portfolio.freshness === "partial") {
    return "partial";
  }
  return "complete";
}

function resolveDataQualityStatus(
  sources: AnalystPortfolioSource[],
  issues: DataQualityIssue[]
): AnalystChartDataQualityStatus {
  if (sources.length === 0) {
    return "empty";
  }
  const statuses = sources.map(sourceQualityStatus);
  if (statuses.includes("failed")) {
    return "failed";
  }
  if (statuses.includes("stale")) {
    return "stale";
  }
  if (statuses.includes("partial") || issues.length > 0) {
    return "partial";
  }
  return "complete";
}

function metricValue(metric: AnalyticsMetric | undefined): number | undefined {
  return metric?.status === "available" ? metric.value : undefined;
}

function metricUnit(metricKey: AnalyticsMetricKey): "percent" | "ratio" | "score" | "currency" {
  if (["totalReturn", "annualizedReturn", "maxDrawdown", "volatility", "sectorExposure"].includes(metricKey)) {
    return "percent";
  }
  if (metricKey === "concentrationHhi") {
    return "score";
  }
  return "ratio";
}

function toPercent(value: number | undefined): number | undefined {
  return value === undefined ? undefined : round(value * 100, 4);
}

function startDateForRange(range: AnalystChartsQuery["range"], now: Date): string | undefined {
  if (range === "all") {
    return undefined;
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (range === "ytd") {
    start.setUTCMonth(0, 1);
  } else if (range === "90d") {
    start.setUTCDate(start.getUTCDate() - 90);
  } else if (range.endsWith("y")) {
    start.setUTCFullYear(start.getUTCFullYear() - Number(range.slice(0, -1)));
  }
  return start.toISOString().slice(0, 10);
}

function formatRangeLabel(min: number, max: number): string {
  return `${round(min, 2)}-${round(max, 2)}`;
}

function uniqueIssues(issues: DataQualityIssue[]): DataQualityIssue[] {
  const seen = new Set<string>();
  const result: DataQualityIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.code}:${issue.message}:${(issue.metricKeys ?? []).join(",")}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(issue);
    }
  }
  return result;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
