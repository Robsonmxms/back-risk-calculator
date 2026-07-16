import { createHash, randomUUID } from "crypto";
import { PortfolioPosition } from "../../01-domain/portfolios/portfolio";
import { LoggerPort, MetricsPort } from "../../02-application/ports/observability";
import {
  CurrencyRateProvider,
  MarketDataProvider,
  MarketDataRepository
} from "../market-data/ports";
import {
  ExchangeRate,
  HistoricalPrice,
  LatestQuote,
  MarketAsset
} from "../market-data/types";
import {
  calculateAnnualizedReturn,
  calculateBeta,
  calculateCorrelationMatrix,
  calculateDrawdowns,
  calculateHhi,
  calculatePeriodicReturns,
  calculateSectorExposure,
  calculateSharpeRatio,
  calculateTotalReturn,
  calculateVolatility,
  round
} from "./formulas";
import { generateRiskInsights } from "./insights";
import {
  AnalyticsEventPublisher,
  AnalyticsPortfolioProjection,
  AnalyticsRepository
} from "./ports";
import {
  AllocationPoint,
  AnalyticsJob,
  AnalyticsMetric,
  AnalyticsMetricKey,
  AnalyticsMetricSet,
  AnalyticsPosition,
  CurrencyConversionAudit,
  DataQualityIssue,
  PortfolioAnalyticsSnapshot,
  TimeSeriesPoint
} from "./types";

const ANALYTICS_BASE_CURRENCY = "USD";
const BENCHMARK_SYMBOL = "SPY";

export interface AnalyticsPortfolioReader {
  listPortfolioPositions(portfolioId: string): Promise<PortfolioPosition[]>;
}

interface ResolvedPosition {
  source: PortfolioPosition;
  asset?: MarketAsset;
  quote?: LatestQuote;
  historicalPrices: HistoricalPrice[];
  marketValueUsd?: number;
  costBasisUsd?: number;
  quoteRate?: ExchangeRate;
  costRate?: ExchangeRate;
  issues: DataQualityIssue[];
}

export class AnalyticsCalculationWorker {
  constructor(
    private readonly analytics: AnalyticsRepository,
    private readonly portfolios: AnalyticsPortfolioReader,
    private readonly marketData: MarketDataRepository,
    private readonly marketDataProvider: MarketDataProvider,
    private readonly currencyRateProvider: CurrencyRateProvider,
    private readonly portfolioProjection: AnalyticsPortfolioProjection,
    private readonly events: AnalyticsEventPublisher,
    private readonly logger: LoggerPort,
    private readonly metrics: MetricsPort,
    private readonly now: () => Date = () => new Date()
  ) {}

  async processNext(): Promise<AnalyticsJob | undefined> {
    const job = await this.analytics.nextQueued();
    if (!job) {
      return undefined;
    }

    return this.processJob(job);
  }

  async processJob(job: AnalyticsJob): Promise<AnalyticsJob> {
    await this.analytics.markRunning(job.id, this.now());
    const startedAt = this.now().getTime();

    try {
      const snapshot = await this.calculateSnapshot(job.portfolioId, startedAt);
      const savedSnapshot = await this.analytics.saveSnapshot(snapshot);

      await this.portfolioProjection.markAnalyticsSucceeded(job.portfolioId, this.now());
      await this.events.publish("AnalyticsUpdated", job.portfolioId, {
        type: "analytics.updated",
        version: 1,
        portfolioId: job.portfolioId,
        snapshotId: savedSnapshot.id,
        status: savedSnapshot.status,
        asOfDate: savedSnapshot.asOfDate,
        metrics: savedSnapshot.metrics,
        correlationId: job.correlationId
      });

      this.metrics.increment("analytics.calculation.success");
      for (let index = 0; index < savedSnapshot.dataQuality.unavailableMetricCount; index += 1) {
        this.metrics.increment("analytics.calculation.unavailable_metric");
      }
      this.logger.info("analytics.calculation.succeeded", {
        portfolioId: job.portfolioId,
        correlationId: job.correlationId,
        status: savedSnapshot.status,
        latencyMs: this.now().getTime() - startedAt
      });

      return (await this.analytics.markSucceeded(job.id, this.now())) ?? job;
    } catch (error) {
      const errorCode = error instanceof Error ? error.message : "analytics.calculation_failed";
      await this.portfolioProjection.markAnalyticsFailed(job.portfolioId, errorCode, this.now());
      await this.events.publish("AnalyticsFailed", job.portfolioId, {
        portfolioId: job.portfolioId,
        jobId: job.id,
        correlationId: job.correlationId,
        errorCode
      });
      this.metrics.increment("analytics.calculation.failure");
      this.logger.warn("analytics.calculation.failed", {
        portfolioId: job.portfolioId,
        correlationId: job.correlationId,
        errorCode
      });

      return (await this.analytics.markFailed(job.id, this.now(), errorCode)) ?? job;
    }
  }

  private async calculateSnapshot(
    portfolioId: string,
    startedAt: number
  ): Promise<PortfolioAnalyticsSnapshot> {
    const positions = await this.portfolios.listPortfolioPositions(portfolioId);
    const range = defaultHistoricalRange(this.now());
    const resolvedPositions: ResolvedPosition[] = [];
    const conversionRates = new Map<string, CurrencyConversionAudit>();
    const issues: DataQualityIssue[] = [];

    for (const position of positions) {
      const resolved = await this.resolvePosition(position, range, conversionRates);
      resolvedPositions.push(resolved);
      issues.push(...resolved.issues);
    }

    const analyticsPositions = this.toAnalyticsPositions(resolvedPositions);
    const totalMarketValueUsd = round(
      resolvedPositions.reduce((sum, position) => sum + (position.marketValueUsd ?? 0), 0),
      2
    );
    const totalCostBasisUsd = round(
      resolvedPositions.reduce((sum, position) => sum + (position.costBasisUsd ?? 0), 0),
      2
    );

    for (const position of analyticsPositions) {
      if (position.marketValueUsd !== undefined && totalMarketValueUsd > 0) {
        position.weightPercent = round((position.marketValueUsd / totalMarketValueUsd) * 100, 2);
      }
    }

    const allocation = this.buildAllocation(analyticsPositions);
    const sectorExposure = calculateSectorExposure(
      analyticsPositions
        .filter(
          (position) => position.marketValueUsd !== undefined && position.weightPercent !== undefined
        )
        .map((position) => ({
          sector: position.sector,
          weight: (position.weightPercent ?? 0) / 100,
          marketValue: position.marketValueUsd ?? 0
        }))
    );
    const performance = this.buildPerformanceSeries(resolvedPositions);
    const portfolioReturns = calculatePeriodicReturns(performance.map((point) => point.value));
    const drawdown = calculateDrawdowns(performance);
    const benchmarkReturns = await this.resolveBenchmarkReturns(range, issues);
    const correlation = calculateCorrelationMatrix(this.buildAssetReturnSeries(resolvedPositions));
    const totalReturn = calculateTotalReturn(totalMarketValueUsd, totalCostBasisUsd);
    const annualizedReturn =
      performance.length >= 2
        ? calculateAnnualizedReturn(
            performance[performance.length - 1].value / performance[0].value - 1,
            daysBetween(performance[0].date, performance[performance.length - 1].date)
          )
        : undefined;
    const volatility = calculateVolatility(portfolioReturns);
    const beta = calculateBeta(portfolioReturns, benchmarkReturns);
    const sharpeRatio = calculateSharpeRatio(annualizedReturn, volatility);
    const concentrationHhi = calculateHhi(
      analyticsPositions
        .map((position) => (position.weightPercent ?? 0) / 100)
        .filter((weight) => weight > 0)
    );
    const averageCorrelation =
      correlation.length > 0
        ? correlation.reduce((sum, cell) => sum + Math.abs(cell.correlation), 0) /
          correlation.length
        : undefined;

    const metrics = this.buildMetrics({
      totalReturn,
      annualizedReturn,
      maxDrawdown: drawdown.maxDrawdown,
      volatility,
      beta,
      sharpeRatio,
      concentrationHhi,
      largestSectorWeight: sectorExposure[0]?.weightPercent,
      averageCorrelation,
      performancePointCount: performance.length,
      positionCount: positions.length,
      correlationPairCount: correlation.length,
      issues
    });
    const unavailableMetricCount = Object.values(metrics).filter(
      (metric) => metric.status === "unavailable"
    ).length;
    const insights = generateRiskInsights({
      metrics,
      positions: analyticsPositions,
      sectorExposure,
      dataQualityIssues: issues
    });

    return {
      id: randomUUID(),
      portfolioId,
      asOfDate: this.now().toISOString().slice(0, 10),
      generatedAt: this.now(),
      baseCurrency: ANALYTICS_BASE_CURRENCY,
      status: unavailableMetricCount === 0 && issues.length === 0 ? "complete" : "partial",
      metrics,
      positions: analyticsPositions,
      allocation,
      sectorExposure,
      performance,
      drawdown: drawdown.series,
      correlation,
      insights,
      dataQuality: {
        issues,
        unavailableMetricCount,
        staleInputCount: issues.filter((issue) => issue.severity === "warning").length,
        conversionRates: Array.from(conversionRates.values())
      },
      inputHash: hashInput({
        positions,
        totalMarketValueUsd,
        totalCostBasisUsd,
        conversionRates: Array.from(conversionRates.values()),
        issueCodes: issues.map((issue) => issue.code).sort()
      }),
      calculationDurationMs: this.now().getTime() - startedAt
    };
  }

  private async resolvePosition(
    position: PortfolioPosition,
    range: { from: string; to: string },
    conversionRates: Map<string, CurrencyConversionAudit>
  ): Promise<ResolvedPosition> {
    const issues: DataQualityIssue[] = [];
    const asset = await this.resolveAsset(position.assetSymbol);
    const quote = await this.resolveLatestQuote(position.assetSymbol, asset, issues);
    const historicalPrices = await this.resolveHistoricalPrices(position.assetSymbol, asset, range, issues);
    const quoteCurrency = quote?.currency ?? position.currency;
    const quoteRate = quote
      ? await this.resolveRateToUsd(quoteCurrency, conversionRates, issues, position.assetSymbol, [
          "totalReturn",
          "annualizedReturn",
          "maxDrawdown",
          "volatility",
          "beta",
          "sharpeRatio",
          "concentrationHhi",
          "sectorExposure",
          "assetCorrelation"
        ])
      : undefined;
    const costRate = await this.resolveRateToUsd(
      position.currency,
      conversionRates,
      issues,
      position.assetSymbol,
      ["totalReturn"]
    );
    const marketValueUsd =
      quote && quoteRate
        ? round(position.quantity * quote.price * quoteRate.rate, 2)
        : undefined;
    const costBasisUsd = costRate
      ? round(position.totalCostBasis * costRate.rate, 2)
      : undefined;

    return {
      source: position,
      asset,
      quote,
      historicalPrices,
      marketValueUsd,
      costBasisUsd,
      quoteRate,
      costRate,
      issues
    };
  }

  private async resolveAsset(symbol: string): Promise<MarketAsset | undefined> {
    const stored = await this.marketData.findAssetBySymbol(symbol);
    if (stored) {
      return stored;
    }

    const candidates = await this.marketDataProvider.searchAssets(symbol).catch(() => []);
    const exact = candidates.find(
      (candidate) =>
        candidate.symbol.toUpperCase() === symbol.toUpperCase() ||
        candidate.providerSymbol.toUpperCase() === symbol.toUpperCase()
    );
    if (!exact) {
      return undefined;
    }

    const [asset] = await this.marketData.upsertAssets([exact]);
    return asset;
  }

  private async resolveLatestQuote(
    symbol: string,
    asset: MarketAsset | undefined,
    issues: DataQualityIssue[]
  ): Promise<LatestQuote | undefined> {
    const providerQuote = await this.marketDataProvider.getLatestQuote(symbol).catch(() => undefined);
    if (providerQuote) {
      const normalizedQuote = {
        ...providerQuote,
        assetId: asset?.id ?? providerQuote.assetId,
        symbol: asset?.symbol ?? providerQuote.symbol,
        updatedAt: this.now()
      };
      await this.marketData.upsertLatestQuote(normalizedQuote);
      return normalizedQuote;
    }

    const storedQuote = asset ? await this.marketData.findLatestQuote(asset.id) : undefined;
    if (storedQuote) {
      issues.push({
        code: "analytics.stored_quote_used",
        severity: "warning",
        message: `Latest provider quote unavailable for ${symbol}; stored quote was used.`,
        symbols: [symbol],
        metricKeys: ["totalReturn", "concentrationHhi", "sectorExposure"]
      });
      return storedQuote;
    }

    issues.push({
      code: "analytics.quote_unavailable",
      severity: "blocking",
      message: `Latest quote unavailable for ${symbol}.`,
      symbols: [symbol],
      metricKeys: [
        "totalReturn",
        "annualizedReturn",
        "maxDrawdown",
        "volatility",
        "beta",
        "sharpeRatio",
        "concentrationHhi",
        "sectorExposure"
      ]
    });
    return undefined;
  }

  private async resolveHistoricalPrices(
    symbol: string,
    asset: MarketAsset | undefined,
    range: { from: string; to: string },
    issues: DataQualityIssue[]
  ): Promise<HistoricalPrice[]> {
    const providerPrices = await this.marketDataProvider
      .getHistoricalPrices(symbol, range)
      .catch(() => undefined);
    if (providerPrices && providerPrices.length > 0) {
      const normalizedPrices = providerPrices.map((price) => ({
        ...price,
        assetId: asset?.id ?? price.assetId,
        symbol: asset?.symbol ?? price.symbol,
        updatedAt: this.now()
      }));
      await this.marketData.upsertHistoricalPrices(normalizedPrices);
      return normalizedPrices;
    }

    const storedPrices = asset ? await this.marketData.listHistoricalPrices(asset.id) : [];
    if (storedPrices.length > 0) {
      issues.push({
        code: "analytics.stored_history_used",
        severity: "warning",
        message: `Historical provider prices unavailable for ${symbol}; stored history was used.`,
        symbols: [symbol],
        metricKeys: ["annualizedReturn", "maxDrawdown", "volatility", "beta", "assetCorrelation"]
      });
      return storedPrices;
    }

    issues.push({
      code: "analytics.history_unavailable",
      severity: "blocking",
      message: `Historical prices unavailable for ${symbol}.`,
      symbols: [symbol],
      metricKeys: ["annualizedReturn", "maxDrawdown", "volatility", "beta", "assetCorrelation"]
    });
    return [];
  }

  private async resolveRateToUsd(
    currency: string,
    conversionRates: Map<string, CurrencyConversionAudit>,
    issues: DataQualityIssue[],
    symbol: string,
    metricKeys: AnalyticsMetricKey[]
  ): Promise<ExchangeRate | undefined> {
    const normalizedCurrency = currency.trim().toUpperCase();
    const key = `${normalizedCurrency}:${ANALYTICS_BASE_CURRENCY}`;
    const existing = conversionRates.get(key);
    if (existing) {
      return {
        from: existing.from,
        to: existing.to,
        rate: existing.rate,
        providerName: existing.providerName,
        asOf: existing.asOf,
        updatedAt: this.now()
      };
    }

    const rate = await this.currencyRateProvider
      .getExchangeRate(normalizedCurrency, ANALYTICS_BASE_CURRENCY)
      .catch(() => undefined);
    if (!rate) {
      issues.push({
        code: "analytics.fx_rate_unavailable",
        severity: "blocking",
        message: `USD conversion rate unavailable for ${normalizedCurrency}.`,
        symbols: [symbol],
        metricKeys
      });
      return undefined;
    }

    conversionRates.set(key, {
      from: rate.from,
      to: "USD",
      rate: rate.rate,
      providerName: rate.providerName,
      asOf: rate.asOf
    });
    return rate;
  }

  private async resolveBenchmarkReturns(
    range: { from: string; to: string },
    issues: DataQualityIssue[]
  ): Promise<number[]> {
    const prices = await this.marketDataProvider
      .getHistoricalPrices(BENCHMARK_SYMBOL, range)
      .catch(() => undefined);

    if (!prices || prices.length < 2) {
      issues.push({
        code: "analytics.benchmark_unavailable",
        severity: "blocking",
        message: `${BENCHMARK_SYMBOL} benchmark history unavailable; beta cannot be calculated.`,
        symbols: [BENCHMARK_SYMBOL],
        metricKeys: ["beta"]
      });
      return [];
    }

    return calculatePeriodicReturns(prices.map((price) => price.adjustedClose));
  }

  private toAnalyticsPositions(resolvedPositions: ResolvedPosition[]): AnalyticsPosition[] {
    return resolvedPositions.map((position) => ({
      portfolioId: position.source.portfolioId,
      assetSymbol: position.source.assetSymbol,
      assetName: position.source.assetName,
      quantity: position.source.quantity,
      currency: position.source.currency,
      exchange: position.asset?.exchange,
      sector: position.asset?.sector ?? "Unknown",
      latestPrice: position.quote?.price,
      latestPriceCurrency: position.quote?.currency,
      marketValueUsd: position.marketValueUsd,
      costBasisUsd: position.costBasisUsd,
      dataQuality: position.issues
    }));
  }

  private buildAllocation(positions: AnalyticsPosition[]): AllocationPoint[] {
    return positions
      .filter(
        (position) => position.marketValueUsd !== undefined && position.weightPercent !== undefined
      )
      .map((position) => ({
        symbol: position.assetSymbol,
        name: position.assetName,
        weightPercent: position.weightPercent ?? 0,
        marketValueUsd: position.marketValueUsd ?? 0
      }))
      .sort((left, right) => right.weightPercent - left.weightPercent);
  }

  private buildPerformanceSeries(resolvedPositions: ResolvedPosition[]): TimeSeriesPoint[] {
    const valuesByDate = new Map<string, number>();

    for (const position of resolvedPositions) {
      if (!position.quoteRate || position.historicalPrices.length === 0) {
        continue;
      }

      for (const price of position.historicalPrices) {
        const currentValue = valuesByDate.get(price.date) ?? 0;
        valuesByDate.set(
          price.date,
          currentValue + price.adjustedClose * position.source.quantity * position.quoteRate.rate
        );
      }
    }

    return Array.from(valuesByDate.entries())
      .map(([date, value]) => ({ date, value: round(value, 2) }))
      .filter((point) => point.value > 0)
      .sort((left, right) => left.date.localeCompare(right.date));
  }

  private buildAssetReturnSeries(resolvedPositions: ResolvedPosition[]): Map<string, number[]> {
    const returnsBySymbol = new Map<string, number[]>();

    for (const position of resolvedPositions) {
      const returns = calculatePeriodicReturns(
        position.historicalPrices.map((price) => price.adjustedClose)
      );
      if (returns.length > 1) {
        returnsBySymbol.set(position.source.assetSymbol, returns);
      }
    }

    return returnsBySymbol;
  }

  private buildMetrics(input: {
    totalReturn?: number;
    annualizedReturn?: number;
    maxDrawdown?: number;
    volatility?: number;
    beta?: number;
    sharpeRatio?: number;
    concentrationHhi?: number;
    largestSectorWeight?: number;
    averageCorrelation?: number;
    performancePointCount: number;
    positionCount: number;
    correlationPairCount: number;
    issues: DataQualityIssue[];
  }): AnalyticsMetricSet {
    return {
      totalReturn: metric("totalReturn", input.totalReturn, {
        label: "Total return",
        unit: "percent",
        unavailableReason: "Requires current market value and USD cost basis.",
        requiredData: ["latest quotes", "position cost basis", "USD conversion rates"]
      }),
      annualizedReturn: metric("annualizedReturn", input.annualizedReturn, {
        label: "Annualized return",
        unit: "percent",
        unavailableReason: "Requires at least two historical portfolio value points.",
        requiredData: ["historical prices", "USD conversion rates"]
      }),
      maxDrawdown: metric("maxDrawdown", input.maxDrawdown, {
        label: "Max drawdown",
        unit: "percent",
        unavailableReason: "Requires at least two historical portfolio value points.",
        requiredData: ["historical prices", "USD conversion rates"]
      }),
      volatility: metric("volatility", input.volatility, {
        label: "Volatility",
        unit: "percent",
        unavailableReason: "Requires at least two portfolio return observations.",
        requiredData: ["historical prices", "USD conversion rates"]
      }),
      beta: metric("beta", input.beta, {
        label: "Beta",
        unit: "ratio",
        unavailableReason: `Requires portfolio returns and ${BENCHMARK_SYMBOL} benchmark returns.`,
        requiredData: ["historical prices", `${BENCHMARK_SYMBOL} benchmark history`]
      }),
      sharpeRatio: metric("sharpeRatio", input.sharpeRatio, {
        label: "Sharpe ratio",
        unit: "ratio",
        unavailableReason: "Requires annualized return and volatility.",
        requiredData: ["annualized return", "volatility"]
      }),
      concentrationHhi: metric("concentrationHhi", input.concentrationHhi, {
        label: "Concentration HHI",
        unit: "score",
        unavailableReason: "Requires current USD market values.",
        requiredData: ["latest quotes", "USD conversion rates"]
      }),
      sectorExposure: metric(
        "sectorExposure",
        input.largestSectorWeight === undefined ? undefined : input.largestSectorWeight / 100,
        {
          label: "Largest sector exposure",
          unit: "percent",
          unavailableReason: "Requires at least one position with current market value.",
          requiredData: ["asset metadata", "latest quotes", "USD conversion rates"]
        }
      ),
      assetCorrelation: metric("assetCorrelation", input.averageCorrelation, {
        label: "Average asset correlation",
        unit: "ratio",
        unavailableReason: "Requires at least two assets with historical return observations.",
        requiredData: ["historical prices for two or more assets"]
      })
    };
  }
}

function metric(
  key: AnalyticsMetricKey,
  value: number | undefined,
  options: {
    label: string;
    unit: AnalyticsMetric["unit"];
    unavailableReason: string;
    requiredData: string[];
  }
): AnalyticsMetric {
  return {
    key,
    label: options.label,
    unit: options.unit,
    status: value === undefined || Number.isNaN(value) ? "unavailable" : "available",
    value: value === undefined || Number.isNaN(value) ? undefined : round(value, 6),
    reason: value === undefined || Number.isNaN(value) ? options.unavailableReason : undefined,
    assumptions: assumptionsFor(key),
    requiredData: options.requiredData
  };
}

function assumptionsFor(key: AnalyticsMetricKey): string[] {
  switch (key) {
    case "totalReturn":
      return ["Current market value and cost basis are converted to USD at calculation time."];
    case "annualizedReturn":
      return ["Historical portfolio values use current holdings and latest available FX rates."];
    case "maxDrawdown":
      return ["Drawdown is measured within the available historical price window."];
    case "volatility":
      return ["Simple daily returns are annualized with 252 trading periods."];
    case "beta":
      return [`${BENCHMARK_SYMBOL} is the benchmark until a configurable benchmark source exists.`];
    case "sharpeRatio":
      return ["Risk-free rate is 0 until a treasury-rate source is configured."];
    case "concentrationHhi":
      return ["HHI uses current USD market-value weights."];
    case "sectorExposure":
      return ["Missing sector metadata is grouped as Unknown."];
    case "assetCorrelation":
      return ["Correlation uses pairwise aligned simple daily returns."];
  }
}

function defaultHistoricalRange(now: Date): { from: string; to: string } {
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(now);
  fromDate.setUTCDate(fromDate.getUTCDate() - 90);

  return {
    from: fromDate.toISOString().slice(0, 10),
    to
  };
}

function daysBetween(from: string, to: string): number {
  return Math.max(
    0,
    Math.round(
      (new Date(`${to}T00:00:00.000Z`).getTime() -
        new Date(`${from}T00:00:00.000Z`).getTime()) /
        86_400_000
    )
  );
}

function hashInput(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
