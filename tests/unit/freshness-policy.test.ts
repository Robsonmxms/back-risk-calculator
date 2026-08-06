import { describe, expect, it } from "vitest";
import {
  classifyFreshness,
  MARKET_DATA_FRESHNESS_POLICY
} from "../../src/01-domain/market-data/freshness";

describe("market-data freshness policy", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");

  it("transitions quotes from fresh to partial and stale using source time", () => {
    const policy = MARKET_DATA_FRESHNESS_POLICY.quote;

    expect(classifyFreshness(new Date(now.getTime() - policy.freshMaxAgeMs), now, policy)).toBe(
      "fresh"
    );
    expect(classifyFreshness(new Date(now.getTime() - policy.freshMaxAgeMs - 1), now, policy)).toBe(
      "partial"
    );
    expect(
      classifyFreshness(new Date(now.getTime() - policy.partialMaxAgeMs - 1), now, policy)
    ).toBe("stale");
  });

  it("transitions analytics snapshots independently from workflow success", () => {
    const policy = MARKET_DATA_FRESHNESS_POLICY.analytics;

    expect(classifyFreshness(new Date("2026-08-06T00:00:00.000Z"), now, policy)).toBe("fresh");
    expect(classifyFreshness(new Date("2026-08-04T12:00:00.000Z"), now, policy)).toBe("partial");
    expect(classifyFreshness(new Date("2026-08-01T12:00:00.000Z"), now, policy)).toBe("stale");
  });
});
