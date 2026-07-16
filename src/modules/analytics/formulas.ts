import {
  CorrelationCell,
  DrawdownPoint,
  SectorExposurePoint,
  TimeSeriesPoint
} from "./types";

const TRADING_PERIODS_PER_YEAR = 252;

// Formula assumptions:
// - Returns are simple periodic returns, not log returns.
// - Volatility is annualized sample standard deviation using 252 trading days.
// - Beta uses covariance(portfolio, benchmark) / variance(benchmark) over aligned periods.
// - Sharpe uses annualized return and volatility. Risk-free rate defaults to 0 until a treasury
//   source is introduced.
// - HHI is sum(weight^2) using decimal weights where 1.0 means 100%.
export function calculatePeriodicReturns(values: number[]): number[] {
  const returns: number[] = [];

  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous > 0 && current > 0) {
      returns.push(current / previous - 1);
    }
  }

  return returns;
}

export function calculateTotalReturn(endingValue: number, costBasis: number): number | undefined {
  if (costBasis <= 0 || endingValue < 0) {
    return undefined;
  }

  return endingValue / costBasis - 1;
}

export function calculateAnnualizedReturn(
  totalReturn: number,
  days: number
): number | undefined {
  if (days <= 0 || totalReturn <= -1) {
    return undefined;
  }

  return Math.pow(1 + totalReturn, 365 / days) - 1;
}

export function calculateDrawdowns(points: TimeSeriesPoint[]): {
  series: DrawdownPoint[];
  maxDrawdown: number | undefined;
} {
  if (points.length < 2) {
    return { series: [], maxDrawdown: undefined };
  }

  let peak = points[0].value;
  let maxDrawdown = 0;
  const series = points.map((point) => {
    peak = Math.max(peak, point.value);
    const drawdown = peak > 0 ? point.value / peak - 1 : 0;
    maxDrawdown = Math.min(maxDrawdown, drawdown);

    return {
      date: point.date,
      drawdownPercent: round(drawdown * 100, 4)
    };
  });

  return { series, maxDrawdown };
}

export function calculateVolatility(
  returns: number[],
  periodsPerYear = TRADING_PERIODS_PER_YEAR
): number | undefined {
  if (returns.length < 2) {
    return undefined;
  }

  const standardDeviation = sampleStandardDeviation(returns);
  return standardDeviation * Math.sqrt(periodsPerYear);
}

export function calculateBeta(
  portfolioReturns: number[],
  benchmarkReturns: number[]
): number | undefined {
  const length = Math.min(portfolioReturns.length, benchmarkReturns.length);
  if (length < 2) {
    return undefined;
  }

  const portfolio = portfolioReturns.slice(-length);
  const benchmark = benchmarkReturns.slice(-length);
  const benchmarkVariance = sampleVariance(benchmark);
  if (benchmarkVariance === 0) {
    return undefined;
  }

  return sampleCovariance(portfolio, benchmark) / benchmarkVariance;
}

export function calculateSharpeRatio(
  annualizedReturn: number | undefined,
  annualizedVolatility: number | undefined,
  annualRiskFreeRate = 0
): number | undefined {
  if (annualizedReturn === undefined || !annualizedVolatility) {
    return undefined;
  }

  return (annualizedReturn - annualRiskFreeRate) / annualizedVolatility;
}

export function calculateHhi(weights: number[]): number | undefined {
  if (weights.length === 0) {
    return undefined;
  }

  return weights.reduce((sum, weight) => sum + weight * weight, 0);
}

export function calculateSectorExposure(
  inputs: Array<{ sector: string; weight: number; marketValue: number }>
): SectorExposurePoint[] {
  const bySector = new Map<string, { weight: number; marketValue: number }>();

  for (const input of inputs) {
    const current = bySector.get(input.sector) ?? { weight: 0, marketValue: 0 };
    current.weight += input.weight;
    current.marketValue += input.marketValue;
    bySector.set(input.sector, current);
  }

  return Array.from(bySector.entries())
    .map(([sector, exposure]) => ({
      sector,
      weightPercent: round(exposure.weight * 100, 2),
      marketValueUsd: round(exposure.marketValue, 2)
    }))
    .sort((left, right) => right.weightPercent - left.weightPercent);
}

export function calculateCorrelationMatrix(
  returnsBySymbol: Map<string, number[]>
): CorrelationCell[] {
  const symbols = Array.from(returnsBySymbol.keys()).sort((left, right) =>
    left.localeCompare(right)
  );
  const cells: CorrelationCell[] = [];

  for (let leftIndex = 0; leftIndex < symbols.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < symbols.length; rightIndex += 1) {
      const leftSymbol = symbols[leftIndex];
      const rightSymbol = symbols[rightIndex];
      const correlation = calculatePearsonCorrelation(
        returnsBySymbol.get(leftSymbol) ?? [],
        returnsBySymbol.get(rightSymbol) ?? []
      );

      if (correlation !== undefined) {
        cells.push({
          leftSymbol,
          rightSymbol,
          correlation: round(correlation, 4)
        });
      }
    }
  }

  return cells;
}

export function calculatePearsonCorrelation(
  leftValues: number[],
  rightValues: number[]
): number | undefined {
  const length = Math.min(leftValues.length, rightValues.length);
  if (length < 2) {
    return undefined;
  }

  const left = leftValues.slice(-length);
  const right = rightValues.slice(-length);
  const leftDeviation = sampleStandardDeviation(left);
  const rightDeviation = sampleStandardDeviation(right);
  if (leftDeviation === 0 || rightDeviation === 0) {
    return undefined;
  }

  return sampleCovariance(left, right) / (leftDeviation * rightDeviation);
}

export function round(value: number, precision = 6): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function sampleCovariance(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  const leftMean = mean(left.slice(0, length));
  const rightMean = mean(right.slice(0, length));
  const sum = left
    .slice(0, length)
    .reduce((total, value, index) => total + (value - leftMean) * (right[index] - rightMean), 0);

  return sum / (length - 1);
}

function sampleVariance(values: number[]): number {
  const deviation = sampleStandardDeviation(values);
  return deviation * deviation;
}

function sampleStandardDeviation(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }

  const valueMean = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - valueMean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
