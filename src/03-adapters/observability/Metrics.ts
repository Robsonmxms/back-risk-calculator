import { MetricsPort } from "../../02-application/ports/observability";

export class Metrics implements MetricsPort {
  private readonly counters = new Map<string, number>();

  increment(metric: string, value = 1): void {
    this.counters.set(metric, (this.counters.get(metric) ?? 0) + value);
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counters.entries());
  }
}
