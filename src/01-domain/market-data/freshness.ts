import { MarketDataFreshness } from "./types";

export const MARKET_DATA_FRESHNESS_POLICY = {
  quote: {
    freshMaxAgeMs: 15 * 60 * 1000,
    partialMaxAgeMs: 24 * 60 * 60 * 1000
  },
  analytics: {
    freshMaxAgeMs: 24 * 60 * 60 * 1000,
    partialMaxAgeMs: 72 * 60 * 60 * 1000
  }
} as const;

export function ageInSeconds(asOf: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - asOf.getTime()) / 1000));
}

export function classifyFreshness(
  asOf: Date,
  now: Date,
  policy: { freshMaxAgeMs: number; partialMaxAgeMs: number }
): MarketDataFreshness {
  const ageMs = Math.max(0, now.getTime() - asOf.getTime());

  if (ageMs <= policy.freshMaxAgeMs) {
    return "fresh";
  }

  return ageMs <= policy.partialMaxAgeMs ? "partial" : "stale";
}
