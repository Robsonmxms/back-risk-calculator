import { createHash, randomUUID } from "crypto";
import { PortfolioPosition } from "../../01-domain/portfolios/portfolio";
import { LoggerPort, MetricsPort } from "../../02-application/ports/observability";
import {
  CurrencyRateProvider,
  MarketDataProvider,
  MarketDataRepository
} from "../../02-application/market-data/ports";
import {
  ExchangeRate,
  HistoricalPrice,
  LatestQuote,
  MarketAsset
} from "../../01-domain/market-data/types";
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
} from "../../01-domain/analytics/formulas";
import { generateRiskInsights } from "../../01-domain/analytics/insights";
import {
  ANALYTICS_CALCULATION_VERSION,
  ANALYTICS_SAMPLE_POLICY,
  satisfiesAnalyticsSamplePolicy
} from "../../01-domain/analytics/sample-policy";
import {
  AnalyticsEventPublisher,
  AnalyticsPortfolioProjection,
  AnalyticsRepository
} from "../../02-application/analytics/ports";
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
} from "../../01-domain/analytics/types";

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
      const insufficientSamples = savedSnapshot.dataQuality.issues.filter(
        (issue) => issue.code === "analytics.insufficient_sample"
      ).length;
      this.metrics.increment("analytics.calculation.insufficient_sample", insufficientSamples);
      this.logger.info("analytics.calculation.succeeded", {
        portfolioId: job.portfolioId,
        correlationId: job.correlationId,
        status: savedSnapshot.status,
        observationCount: savedSnapshot.metrics.annualizedReturn.observationCount,
        effectiveHorizonDays: savedSnapshot.metrics.annualizedReturn.effectiveHorizonDays,
        calculationVersion: ANALYTICS_CALCULATION_VERSION,
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
          (position) =>
            position.marketValueUsd !== undefined && position.weightPercent !== undefined
        )
        .map((position) => ({
          sector: position.sector,
          weight: (position.weightPercent ?? 0) / 100,
          marketValue: position.marketValueUsd ?? 0
        }))
    );
    const performance = this.buildPerformanceSeries(resolvedPositions);
    const portfolioReturns = calculatePeriodicReturns(performance.map((point) => point.value));
    const performanceHorizonDays =
      performance.length >= 2
        ? daysBetween(performance[0].date, performance[performance.length - 1].date)
        : 0;
    const drawdown = calculateDrawdowns(performance);
    const benchmarkReturns = await this.resolveBenchmarkReturns(range, issues);
    const assetReturnSeries = this.buildAssetReturnSeries(resolvedPositions);
    const correlationObservationCount = maximumPairObservationCount(assetReturnSeries);
    const eligibleCorrelationSeries = new Map(
      Array.from(assetReturnSeries.entries()).filter(([, returns]) =>
        satisfiesAnalyticsSamplePolicy("assetCorrelation", returns.length, performanceHorizonDays)
      )
    );
    const correlation = calculateCorrelationMatrix(eligibleCorrelationSeries);
    const totalReturn = calculateTotalReturn(totalMarketValueUsd, totalCostBasisUsd);
    const annualizedReturn = satisfiesAnalyticsSamplePolicy(
      "annualizedReturn",
      portfolioReturns.length,
      performanceHorizonDays
    )
      ? calculateAnnualizedReturn(
          performance[performance.length - 1].value / performance[0].value - 1,
          performanceHorizonDays
        )
      : undefined;
    const volatility = satisfiesAnalyticsSamplePolicy(
      "volatility",
      portfolioReturns.length,
      performanceHorizonDays
    )
      ? calculateVolatility(portfolioReturns)
      : undefined;
    const betaObservationCount = Math.min(portfolioReturns.length, benchmarkReturns.length);
    const beta = satisfiesAnalyticsSamplePolicy(
      "beta",
      betaObservationCount,
      performanceHorizonDays
    )
      ? calculateBeta(portfolioReturns, benchmarkReturns)
      : undefined;
    const sharpeRatio = satisfiesAnalyticsSamplePolicy(
      "sharpeRatio",
      portfolioReturns.length,
      performanceHorizonDays
    )
      ? calculateSharpeRatio(annualizedReturn, volatility)
      : undefined;
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

    issues.push(
      ...samplePolicyIssues({
        portfolioObservationCount: portfolioReturns.length,
        betaObservationCount,
        correlationObservationCount,
        effectiveHorizonDays: performanceHorizonDays
      })
    );

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
      performanceObservationCount: portfolioReturns.length,
      betaObservationCount,
      correlationObservationCount,
      effectiveHorizonDays: performanceHorizonDays,
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
    const historicalPrices = await this.resolveHistoricalPrices(
      position.assetSymbol,
      asset,
      range,
      issues
    );
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
      quote && quoteRate ? round(position.quantity * quote.price * quoteRate.rate, 2) : undefined;
    const costBasisUsd = costRate ? round(position.totalCostBasis * costRate.rate, 2) : undefined;

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
    const providerQuote = await this.marketDataProvider
      .getLatestQuote(symbol)
      .catch(() => undefined);
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
        updatedAt: existing.updatedAt
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
      asOf: rate.asOf,
      updatedAt: rate.updatedAt
    });
    return rate;
  }

  private async resolveBenchmarkReturns(
    range: { from: string; to: string },
    issues: DataQualityIssue[]
  ): Promise<number[]> {
    const benchmarkAsset = await this.resolveAsset(BENCHMARK_SYMBOL);
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

    const normalizedPrices = prices.map((price) => ({
      ...price,
      assetId: benchmarkAsset?.id ?? price.assetId,
      symbol: benchmarkAsset?.symbol ?? price.symbol,
      updatedAt: this.now()
    }));
    await this.marketData.upsertHistoricalPrices(normalizedPrices);

    return calculatePeriodicReturns(normalizedPrices.map((price) => price.adjustedClose));
  }

  private toAnalyticsPositions(resolvedPositions: ResolvedPosition[]): AnalyticsPosition[] {
    return resolvedPositions.map((position) => ({
      portfolioId: position.source.portfolioId,
      assetSymbol: position.source.assetSymbol,
      assetName: position.source.assetName,
      quantity: position.source.quantity,
      currency: position.source.currency,
      exchange: position.asset?.exchange,
      sector: position.asset?.sector ?? "Não classificado",
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
      if (returns.length > 0) {
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
    performanceObservationCount: number;
    betaObservationCount: number;
    correlationObservationCount: number;
    effectiveHorizonDays: number;
    positionCount: number;
    correlationPairCount: number;
    issues: DataQualityIssue[];
  }): AnalyticsMetricSet {
    return {
      totalReturn: metric("totalReturn", input.totalReturn, {
        label: "Retorno total",
        unit: "percent",
        unavailableReason: "Requer valor de mercado atual e custo-base em USD.",
        requiredData: [
          "cotações mais recentes",
          "custo-base das posições",
          "taxas de conversão para USD"
        ],
        observationCount: input.positionCount,
        effectiveHorizonDays: input.effectiveHorizonDays
      }),
      annualizedReturn: metric("annualizedReturn", input.annualizedReturn, {
        label: "Retorno anualizado",
        unit: "percent",
        unavailableReason: minimumSampleReason("annualizedReturn"),
        unavailableReasonCode: "analytics.insufficient_sample",
        requiredData: ["preços históricos", "taxas de conversão para USD"],
        observationCount: input.performanceObservationCount,
        effectiveHorizonDays: input.effectiveHorizonDays
      }),
      maxDrawdown: metric("maxDrawdown", input.maxDrawdown, {
        label: "Drawdown máximo",
        unit: "percent",
        unavailableReason: "Requer ao menos dois pontos históricos do valor do portfólio.",
        requiredData: ["preços históricos", "taxas de conversão para USD"],
        observationCount: input.performancePointCount,
        effectiveHorizonDays: input.effectiveHorizonDays
      }),
      volatility: metric("volatility", input.volatility, {
        label: "Volatilidade",
        unit: "percent",
        unavailableReason: minimumSampleReason("volatility"),
        unavailableReasonCode: "analytics.insufficient_sample",
        requiredData: ["preços históricos", "taxas de conversão para USD"],
        observationCount: input.performanceObservationCount,
        effectiveHorizonDays: input.effectiveHorizonDays
      }),
      beta: metric("beta", input.beta, {
        label: "Beta",
        unit: "ratio",
        unavailableReason: minimumSampleReason("beta"),
        unavailableReasonCode: "analytics.insufficient_sample",
        requiredData: ["preços históricos", `histórico do benchmark ${BENCHMARK_SYMBOL}`],
        observationCount: input.betaObservationCount,
        effectiveHorizonDays: input.effectiveHorizonDays
      }),
      sharpeRatio: metric("sharpeRatio", input.sharpeRatio, {
        label: "Índice de Sharpe",
        unit: "ratio",
        unavailableReason: minimumSampleReason("sharpeRatio"),
        unavailableReasonCode: "analytics.insufficient_sample",
        requiredData: ["retorno anualizado", "volatilidade"],
        observationCount: input.performanceObservationCount,
        effectiveHorizonDays: input.effectiveHorizonDays
      }),
      concentrationHhi: metric("concentrationHhi", input.concentrationHhi, {
        label: "Concentração HHI",
        unit: "score",
        unavailableReason: "Requer valores de mercado atuais em USD.",
        requiredData: ["cotações mais recentes", "taxas de conversão para USD"],
        observationCount: input.positionCount,
        effectiveHorizonDays: input.effectiveHorizonDays
      }),
      sectorExposure: metric(
        "sectorExposure",
        input.largestSectorWeight === undefined ? undefined : input.largestSectorWeight / 100,
        {
          label: "Maior exposição setorial",
          unit: "percent",
          unavailableReason: "Requer ao menos uma posição com valor de mercado atual.",
          requiredData: [
            "metadados do ativo",
            "cotações mais recentes",
            "taxas de conversão para USD"
          ],
          observationCount: input.positionCount,
          effectiveHorizonDays: input.effectiveHorizonDays
        }
      ),
      assetCorrelation: metric("assetCorrelation", input.averageCorrelation, {
        label: "Correlação média entre ativos",
        unit: "ratio",
        unavailableReason: minimumSampleReason("assetCorrelation"),
        unavailableReasonCode: "analytics.insufficient_sample",
        requiredData: ["preços históricos de dois ou mais ativos"],
        observationCount: input.correlationObservationCount,
        effectiveHorizonDays: input.effectiveHorizonDays
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
    unavailableReasonCode?: string;
    requiredData: string[];
    observationCount: number;
    effectiveHorizonDays: number;
  }
): AnalyticsMetric {
  return {
    key,
    label: options.label,
    unit: options.unit,
    status: value === undefined || Number.isNaN(value) ? "unavailable" : "available",
    value: value === undefined || Number.isNaN(value) ? undefined : round(value, 6),
    reason: value === undefined || Number.isNaN(value) ? options.unavailableReason : undefined,
    reasonCode:
      value === undefined || Number.isNaN(value) ? options.unavailableReasonCode : undefined,
    observationCount: options.observationCount,
    effectiveHorizonDays: options.effectiveHorizonDays,
    calculationVersion: ANALYTICS_CALCULATION_VERSION,
    assumptions: assumptionsFor(key),
    requiredData: options.requiredData
  };
}

function minimumSampleReason(metricKey: keyof typeof ANALYTICS_SAMPLE_POLICY): string {
  const policy = ANALYTICS_SAMPLE_POLICY[metricKey];
  return `Requer ao menos ${policy.minimumObservations} retornos e ${policy.minimumHorizonDays} dias de horizonte efetivo.`;
}

function samplePolicyIssues(input: {
  portfolioObservationCount: number;
  betaObservationCount: number;
  correlationObservationCount: number;
  effectiveHorizonDays: number;
}): DataQualityIssue[] {
  const samples = [
    ["annualizedReturn", input.portfolioObservationCount],
    ["volatility", input.portfolioObservationCount],
    ["beta", input.betaObservationCount],
    ["sharpeRatio", input.portfolioObservationCount],
    ["assetCorrelation", input.correlationObservationCount]
  ] as const;

  return samples
    .filter(
      ([metricKey, observations]) =>
        !satisfiesAnalyticsSamplePolicy(metricKey, observations, input.effectiveHorizonDays)
    )
    .map(([metricKey, observations]) => ({
      code: "analytics.insufficient_sample",
      severity: "blocking" as const,
      message: `${minimumSampleReason(metricKey)} Amostra atual: ${observations} retornos em ${input.effectiveHorizonDays} dias.`,
      metricKeys: [metricKey]
    }));
}

function maximumPairObservationCount(series: Map<string, number[]>): number {
  const lengths = Array.from(series.values())
    .map((returns) => returns.length)
    .sort((left, right) => right - left);
  return lengths.length >= 2 ? Math.min(lengths[0], lengths[1]) : 0;
}

function assumptionsFor(key: AnalyticsMetricKey): string[] {
  switch (key) {
    case "totalReturn":
      return ["O valor de mercado atual e o custo-base são convertidos para USD no cálculo."];
    case "annualizedReturn":
      return ["Os valores históricos usam as posições atuais e as taxas de câmbio disponíveis."];
    case "maxDrawdown":
      return ["O drawdown é medido na janela histórica de preços disponível."];
    case "volatility":
      return ["Retornos diários simples são anualizados com 252 pregões."];
    case "beta":
      return [`${BENCHMARK_SYMBOL} é o benchmark enquanto não houver configuração por portfólio.`];
    case "sharpeRatio":
      return ["A taxa livre de risco é 0 até existir uma fonte configurada."];
    case "concentrationHhi":
      return ["O HHI usa os pesos atuais por valor de mercado em USD."];
    case "sectorExposure":
      return ["Ativos sem metadados de setor são agrupados como Não classificado."];
    case "assetCorrelation":
      return ["A correlação usa retornos diários simples alinhados por par."];
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
      (new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) /
        86_400_000
    )
  );
}

function hashInput(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
