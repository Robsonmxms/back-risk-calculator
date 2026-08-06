export const ANALYTICS_CALCULATION_VERSION = "risk-v2-minimum-sample";

export const ANALYTICS_SAMPLE_POLICY = {
  annualizedReturn: { minimumObservations: 30, minimumHorizonDays: 30 },
  volatility: { minimumObservations: 30, minimumHorizonDays: 30 },
  beta: { minimumObservations: 30, minimumHorizonDays: 30 },
  sharpeRatio: { minimumObservations: 30, minimumHorizonDays: 30 },
  assetCorrelation: { minimumObservations: 30, minimumHorizonDays: 30 }
} as const;

export type SamplePolicyMetric = keyof typeof ANALYTICS_SAMPLE_POLICY;

export function satisfiesAnalyticsSamplePolicy(
  metric: SamplePolicyMetric,
  observationCount: number,
  effectiveHorizonDays: number
): boolean {
  const policy = ANALYTICS_SAMPLE_POLICY[metric];
  return (
    observationCount >= policy.minimumObservations &&
    effectiveHorizonDays >= policy.minimumHorizonDays
  );
}
