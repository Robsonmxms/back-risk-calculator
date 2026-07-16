import { describe, expect, it } from "vitest";
import {
  calculateAnnualizedReturn,
  calculateBeta,
  calculateCorrelationMatrix,
  calculateDrawdowns,
  calculateHhi,
  calculatePeriodicReturns,
  calculateSharpeRatio,
  calculateTotalReturn,
  calculateVolatility
} from "../../src/modules/analytics/formulas";

describe("analytics formulas", () => {
  it("calculates return, annualized return and drawdown from value series", () => {
    const values = [100, 110, 105, 120];
    const returns = calculatePeriodicReturns(values);
    const drawdown = calculateDrawdowns([
      { date: "2026-07-01", value: 100 },
      { date: "2026-07-02", value: 110 },
      { date: "2026-07-03", value: 105 },
      { date: "2026-07-04", value: 120 }
    ]);

    expect(calculateTotalReturn(120, 100)).toBeCloseTo(0.2);
    expect(calculateAnnualizedReturn(0.2, 30)).toBeGreaterThan(0.2);
    expect(returns).toHaveLength(3);
    expect(drawdown.maxDrawdown).toBeCloseTo(-0.0454545);
  });

  it("calculates volatility, beta, sharpe, HHI and correlations", () => {
    const portfolioReturns = [0.01, 0.02, -0.01, 0.03];
    const benchmarkReturns = [0.008, 0.015, -0.006, 0.02];
    const correlations = calculateCorrelationMatrix(
      new Map([
        ["AAA", [0.01, 0.02, 0.03]],
        ["BBB", [0.02, 0.03, 0.04]]
      ])
    );

    expect(calculateVolatility(portfolioReturns)).toBeGreaterThan(0);
    expect(calculateBeta(portfolioReturns, benchmarkReturns)).toBeGreaterThan(1);
    expect(calculateSharpeRatio(0.12, 0.2)).toBeCloseTo(0.6);
    expect(calculateHhi([0.5, 0.25, 0.25])).toBeCloseTo(0.375);
    expect(correlations).toEqual([
      expect.objectContaining({
        leftSymbol: "AAA",
        rightSymbol: "BBB",
        correlation: 1
      })
    ]);
  });
});
