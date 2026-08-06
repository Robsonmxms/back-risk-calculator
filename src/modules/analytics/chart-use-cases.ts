import { Account, AccountMember } from "../../01-domain/accounts/account";
import { Actor } from "../../01-domain/auth/actor";
import { Portfolio, PortfolioPosition } from "../../01-domain/portfolios/portfolio";
import { assertCanReadAccountLedger } from "../../02-application/auth/policies";
import { ApplicationError } from "../../02-application/errors/application-error";
import { LoggerPort, MetricsPort } from "../../02-application/ports/observability";
import {
  AccountRepository,
  PortfolioRepository
} from "../../02-application/ports/repositories";
import { MarketDataRepository } from "../market-data/ports";
import { HistoricalPrice } from "../market-data/types";
import {
  calculateDrawdowns,
  calculatePeriodicReturns,
  calculateVolatility,
  round
} from "./formulas";
import { AnalyticsRepository } from "./ports";
import {
  AllocationPoint,
  DataQualityIssue,
  PortfolioAnalyticsSnapshot,
  TimeSeriesPoint
} from "./types";
import {
  AssetPriceChartSeries,
  BenchmarkComparisonPoint,
  ChartAnnotation,
  CumulativeReturnPoint,
  PortfolioChartBundle,
  PortfolioChartDataQualityStatus,
  PortfolioChartRange,
  PortfolioChartsQuery,
  PortfolioChartResponse,
  RollingRiskPoint
} from "./chart-types";

const STANDARD_CHART_KEYS = [
  "assetPrices",
  "portfolioPerformance",
  "cumulativeReturn",
  "allocation",
  "sectorExposure",
  "drawdown",
  "rollingRisk",
  "correlation",
  "benchmarkComparison",
  "annotations"
] as const;

interface PortfolioAccess {
  portfolio: Portfolio;
  account: Account;
  membership?: AccountMember;
}

export class GetPortfolioChartsUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly portfolios: PortfolioRepository,
    private readonly analytics: AnalyticsRepository,
    private readonly marketData: MarketDataRepository,
    private readonly logger: LoggerPort,
    private readonly metrics: MetricsPort,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    actor: Actor,
    portfolioId: string,
    query: PortfolioChartsQuery
  ): Promise<PortfolioChartResponse> {
    const startedAt = this.now().getTime();
    const access = await this.assertChartAccess(actor, portfolioId);
    const [snapshot, latestJob, positions, ledgerSnapshots, transactions] = await Promise.all([
      this.analytics.findLatestSnapshot(portfolioId),
      this.analytics.findLatestJob(portfolioId),
      this.portfolios.listPortfolioPositions(portfolioId),
      this.portfolios.listPortfolioSnapshots(portfolioId),
      this.portfolios.listPortfolioTransactions(portfolioId)
    ]);
    const issues = [...(snapshot?.dataQuality.issues ?? [])];
    const unavailableChartKeys = new Set<string>();
    const rangeStart = startDateForRange(query.range, this.now());
    const requestedSymbols = parseList(query.assetSymbols).map((symbol) => symbol.toUpperCase());
    const heldSymbols = Array.from(new Set(positions.map((position) => position.assetSymbol))).sort(
      (left, right) => left.localeCompare(right)
    );
    const selectedSymbols =
      requestedSymbols.length > 0
        ? requestedSymbols.filter((symbol) => heldSymbols.includes(symbol))
        : heldSymbols;

    for (const symbol of requestedSymbols) {
      if (!heldSymbols.includes(symbol)) {
        issues.push({
          code: "charts.asset_not_in_portfolio",
          severity: "warning",
          message: `Requested symbol ${symbol} is not held by this portfolio.`,
          symbols: [symbol]
        });
      }
    }

    const assetPrices = await this.buildAssetPrices(
      selectedSymbols,
      query,
      rangeStart,
      issues,
      unavailableChartKeys
    );
    const portfolioPerformance = this.buildPortfolioPerformance(
      snapshot,
      ledgerSnapshots.map((entry) => ({
        date: entry.asOfDate,
        value: entry.totalCostBasis
      })),
      rangeStart,
      unavailableChartKeys
    );
    const cumulativeReturn = buildCumulativeReturn(portfolioPerformance, unavailableChartKeys);
    const allocation = snapshot?.allocation.length
      ? snapshot.allocation
      : buildPositionAllocation(positions, unavailableChartKeys);
    const sectorExposure = snapshot?.sectorExposure.length
      ? snapshot.sectorExposure
      : buildFallbackSectorExposure(positions, unavailableChartKeys);
    const drawdown =
      snapshot?.drawdown.length
        ? snapshot.drawdown.filter((point) => isInRange(point.date, rangeStart))
        : calculateDrawdowns(portfolioPerformance).series;
    if (drawdown.length === 0) {
      unavailableChartKeys.add("drawdown");
    }

    const rollingRisk = buildRollingRisk(portfolioPerformance, unavailableChartKeys);
    const correlationSymbols = buildCorrelationSymbols(snapshot, positions);
    if (correlationSymbols.length >= 2 && (snapshot?.correlation.length ?? 0) === 0) {
      issues.push({
        code: "charts.correlation_insufficient_samples",
        severity: "warning",
        message: "Correlation needs at least two aligned return samples.",
        symbols: correlationSymbols
      });
      unavailableChartKeys.add("correlation");
    }
    const benchmarkComparison = await this.buildBenchmarkComparison(
      query.benchmarkSymbol,
      query,
      rangeStart,
      issues,
      unavailableChartKeys
    );
    const annotations = buildAnnotations(portfolioId, transactions, snapshot);

    const dataQualityStatus = resolveDataQualityStatus(
      snapshot,
      latestJob?.status,
      issues,
      unavailableChartKeys
    );
    const bundle: PortfolioChartBundle = {
      portfolioId,
      asOfDate: snapshot?.asOfDate ?? this.now().toISOString().slice(0, 10),
      range: query.range,
      interval: query.interval,
      baseCurrency: (query.baseCurrency ?? access.portfolio.baseCurrency).toUpperCase(),
      charts: {
        assetPrices,
        portfolioPerformance,
        cumulativeReturn,
        allocation,
        sectorExposure,
        drawdown,
        rollingRisk,
        correlation: {
          symbols: correlationSymbols,
          cells: snapshot?.correlation ?? []
        },
        benchmarkComparison,
        annotations
      },
      dataQuality: {
        status: dataQualityStatus,
        issues: uniqueIssues(issues),
        staleInputCount:
          snapshot?.dataQuality.staleInputCount ??
          issues.filter((issue) => issue.severity === "warning").length,
        unavailableChartKeys: Array.from(unavailableChartKeys).sort((left, right) =>
          left.localeCompare(right)
        )
      }
    };

    this.metrics.increment("analytics.charts.portfolio.request");
    if (bundle.dataQuality.status !== "complete") {
      this.metrics.increment("analytics.charts.portfolio.partial");
    }
    this.logger.info("analytics.charts.portfolio.generated", {
      actorId: actor.id,
      portfolioId,
      range: query.range,
      interval: query.interval,
      chartKeyCount: STANDARD_CHART_KEYS.length,
      partialChartCount: bundle.dataQuality.unavailableChartKeys.length,
      latencyMs: this.now().getTime() - startedAt
    });

    return {
      data: bundle,
      meta: {
        sourceSnapshotId: snapshot?.id,
        generatedAt: this.now().toISOString(),
        latestJobStatus: latestJob?.status
      }
    };
  }

  private async assertChartAccess(
    actor: Actor,
    portfolioId: string
  ): Promise<PortfolioAccess> {
    const denied = () =>
      new ApplicationError(
        "forbidden",
        "auth.portfolio_chart_access_denied",
        "Portfolio chart access denied"
      );

    const portfolio = await this.portfolios.findPortfolioById(portfolioId);
    if (!portfolio) {
      throw denied();
    }

    const account = await this.accounts.findAccountById(portfolio.accountId);
    if (!account) {
      throw denied();
    }

    const membership = await this.accounts.findMembership(portfolio.accountId, actor.id);
    try {
      assertCanReadAccountLedger(actor, account, membership);
    } catch (error) {
      if (error instanceof ApplicationError) {
        this.metrics.increment("analytics.charts.portfolio.denied");
        throw denied();
      }

      throw error;
    }

    return { portfolio, account, membership };
  }

  private async buildAssetPrices(
    symbols: string[],
    query: PortfolioChartsQuery,
    rangeStart: string | undefined,
    issues: DataQualityIssue[],
    unavailableChartKeys: Set<string>
  ): Promise<AssetPriceChartSeries[]> {
    const series: AssetPriceChartSeries[] = [];

    for (const symbol of symbols) {
      const asset = await this.marketData.findAssetBySymbol(symbol);
      if (!asset) {
        issues.push({
          code: "charts.asset_history_unavailable",
          severity: "warning",
          message: `No stored market asset was found for ${symbol}.`,
          symbols: [symbol]
        });
        unavailableChartKeys.add("assetPrices");
        continue;
      }

      const latestQuote = await this.marketData.findLatestQuote(asset.id);
      const history = compactHistoryByInterval(
        (await this.marketData.listHistoricalPrices(asset.id)).filter((price) =>
          isInRange(price.date, rangeStart)
        ),
        query.interval
      );

      if (history.length === 0) {
        issues.push({
          code: "charts.history_unavailable",
          severity: "warning",
          message: `No stored historical prices were available for ${symbol}.`,
          symbols: [symbol]
        });
        unavailableChartKeys.add("assetPrices");
      }

      series.push({
        assetId: asset.id,
        symbol: asset.symbol,
        name: asset.name,
        currency: asset.currency,
        providerName: asset.providerName,
        freshness: latestQuote?.freshness ?? "stale",
        points: history.map((price) => ({
          date: price.date,
          close: price.close,
          adjustedClose: price.adjustedClose
        }))
      });
    }

    if (series.length === 0) {
      unavailableChartKeys.add("assetPrices");
    }

    return series;
  }

  private buildPortfolioPerformance(
    snapshot: PortfolioAnalyticsSnapshot | undefined,
    ledgerPerformance: TimeSeriesPoint[],
    rangeStart: string | undefined,
    unavailableChartKeys: Set<string>
  ): TimeSeriesPoint[] {
    const performance = (snapshot?.performance.length ? snapshot.performance : ledgerPerformance)
      .filter((point) => isInRange(point.date, rangeStart))
      .sort((left, right) => left.date.localeCompare(right.date));

    if (performance.length === 0) {
      unavailableChartKeys.add("portfolioPerformance");
    }

    return performance;
  }

  private async buildBenchmarkComparison(
    benchmarkSymbol: string | undefined,
    query: PortfolioChartsQuery,
    rangeStart: string | undefined,
    issues: DataQualityIssue[],
    unavailableChartKeys: Set<string>
  ): Promise<BenchmarkComparisonPoint[]> {
    const symbol = benchmarkSymbol?.trim().toUpperCase();
    if (!symbol) {
      return [];
    }

    const asset = await this.marketData.findAssetBySymbol(symbol);
    if (!asset) {
      issues.push({
        code: "charts.benchmark_unavailable",
        severity: "warning",
        message: `Benchmark ${symbol} is unavailable in stored backend market data.`,
        symbols: [symbol]
      });
      unavailableChartKeys.add("benchmarkComparison");
      return [];
    }

    const history = compactHistoryByInterval(
      (await this.marketData.listHistoricalPrices(asset.id)).filter((price) =>
        isInRange(price.date, rangeStart)
      ),
      query.interval
    );
    if (history.length < 2) {
      issues.push({
        code: "charts.benchmark_history_insufficient",
        severity: "warning",
        message: `Benchmark ${symbol} does not have enough stored history for comparison.`,
        symbols: [symbol]
      });
      unavailableChartKeys.add("benchmarkComparison");
      return [];
    }

    const first = history[0].adjustedClose || history[0].close;
    return history.map((price) => ({
      date: price.date,
      symbol,
      returnPercent: first > 0 ? round(((price.adjustedClose || price.close) / first - 1) * 100, 4) : 0
    }));
  }
}

function buildCumulativeReturn(
  performance: TimeSeriesPoint[],
  unavailableChartKeys: Set<string>
): CumulativeReturnPoint[] {
  if (performance.length < 2 || performance[0].value <= 0) {
    unavailableChartKeys.add("cumulativeReturn");
    return [];
  }

  const first = performance[0].value;
  return performance.map((point) => ({
    date: point.date,
    returnPercent: round((point.value / first - 1) * 100, 4)
  }));
}

function buildRollingRisk(
  performance: TimeSeriesPoint[],
  unavailableChartKeys: Set<string>
): RollingRiskPoint[] {
  const returns = calculatePeriodicReturns(performance.map((point) => point.value));
  const points: RollingRiskPoint[] = [];
  const windowSize = 3;

  for (let endIndex = 1; endIndex < returns.length; endIndex += 1) {
    const window = returns.slice(Math.max(0, endIndex - windowSize + 1), endIndex + 1);
    const volatility = calculateVolatility(window);
    const currentPoint = performance[endIndex + 1];
    const windowStartPoint = performance[endIndex + 1 - window.length];
    if (volatility === undefined || !currentPoint || !windowStartPoint || windowStartPoint.value <= 0) {
      continue;
    }

    points.push({
      date: currentPoint.date,
      volatilityPercent: round(volatility * 100, 4),
      rollingReturnPercent: round((currentPoint.value / windowStartPoint.value - 1) * 100, 4),
      sampleSize: window.length
    });
  }

  if (points.length === 0) {
    unavailableChartKeys.add("rollingRisk");
  }

  return points;
}

function buildPositionAllocation(
  positions: PortfolioPosition[],
  unavailableChartKeys: Set<string>
): AllocationPoint[] {
  const total = positions.reduce((sum, position) => sum + position.totalCostBasis, 0);
  if (total <= 0) {
    unavailableChartKeys.add("allocation");
    return [];
  }

  return positions
    .map((position) => ({
      symbol: position.assetSymbol,
      name: position.assetName,
      weightPercent: round((position.totalCostBasis / total) * 100, 2),
      marketValueUsd: round(position.totalCostBasis, 2)
    }))
    .sort((left, right) => right.weightPercent - left.weightPercent);
}

function buildFallbackSectorExposure(
  positions: PortfolioPosition[],
  unavailableChartKeys: Set<string>
) {
  const total = positions.reduce((sum, position) => sum + position.totalCostBasis, 0);
  if (total <= 0) {
    unavailableChartKeys.add("sectorExposure");
    return [];
  }

  return [
    {
      sector: "Não classificado",
      weightPercent: 100,
      marketValueUsd: round(total, 2)
    }
  ];
}

function buildCorrelationSymbols(
  snapshot: PortfolioAnalyticsSnapshot | undefined,
  positions: PortfolioPosition[]
): string[] {
  return Array.from(
    new Set([
      ...(snapshot?.positions.map((position) => position.assetSymbol) ?? []),
      ...positions.map((position) => position.assetSymbol),
      ...(snapshot?.correlation.flatMap((cell) => [cell.leftSymbol, cell.rightSymbol]) ?? [])
    ])
  ).sort((left, right) => left.localeCompare(right));
}

function buildAnnotations(
  portfolioId: string,
  transactions: Array<{ id: string; tradeDate: string; type: "buy" | "sell"; assetSymbol: string }>,
  snapshot: PortfolioAnalyticsSnapshot | undefined
): ChartAnnotation[] {
  const transactionAnnotations = transactions.map((transaction) => ({
    id: `txn-${transaction.id}`,
    date: transaction.tradeDate,
    type: "transaction" as const,
    label: `${transaction.type === "buy" ? "Compra" : "Venda"} de ${transaction.assetSymbol}`,
    portfolioId,
    relatedId: transaction.id
  }));
  const analyticsAnnotation = snapshot
    ? [
        {
          id: `analytics-${snapshot.id}`,
          date: snapshot.asOfDate,
          type: "analytics" as const,
          label: "Retrato analitico recalculado",
          portfolioId,
          relatedId: snapshot.id
        }
      ]
    : [];

  return [...transactionAnnotations, ...analyticsAnnotation].sort((left, right) =>
    left.date.localeCompare(right.date)
  );
}

function compactHistoryByInterval(
  prices: HistoricalPrice[],
  interval: PortfolioChartsQuery["interval"]
): HistoricalPrice[] {
  const sorted = [...prices].sort((left, right) => left.date.localeCompare(right.date));
  if (interval === "daily") {
    return sorted;
  }

  const byPeriod = new Map<string, HistoricalPrice>();
  for (const price of sorted) {
    byPeriod.set(periodKey(price.date, interval), price);
  }

  return Array.from(byPeriod.values()).sort((left, right) => left.date.localeCompare(right.date));
}

function periodKey(date: string, interval: "weekly" | "monthly"): string {
  if (interval === "monthly") {
    return date.slice(0, 7);
  }

  const parsed = new Date(`${date}T00:00:00.000Z`);
  const yearStart = new Date(Date.UTC(parsed.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((parsed.getTime() - yearStart.getTime()) / 86_400_000);
  return `${parsed.getUTCFullYear()}-${Math.floor(dayOfYear / 7)}`;
}

function startDateForRange(range: PortfolioChartRange, now: Date): string | undefined {
  if (range === "all") {
    return undefined;
  }

  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (range === "ytd") {
    start.setUTCMonth(0, 1);
  } else if (range.endsWith("m")) {
    start.setUTCMonth(start.getUTCMonth() - Number(range.slice(0, -1)));
  } else if (range.endsWith("y")) {
    start.setUTCFullYear(start.getUTCFullYear() - Number(range.slice(0, -1)));
  }

  return start.toISOString().slice(0, 10);
}

function isInRange(date: string, rangeStart: string | undefined): boolean {
  return !rangeStart || date >= rangeStart;
}

function parseList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function resolveDataQualityStatus(
  snapshot: PortfolioAnalyticsSnapshot | undefined,
  latestJobStatus: string | undefined,
  issues: DataQualityIssue[],
  unavailableChartKeys: Set<string>
): PortfolioChartDataQualityStatus {
  if (latestJobStatus === "failed") {
    return "failed";
  }

  if (!snapshot) {
    return "pending";
  }

  if (snapshot.status === "partial" || issues.length > 0 || unavailableChartKeys.size > 0) {
    return "partial";
  }

  return "complete";
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
