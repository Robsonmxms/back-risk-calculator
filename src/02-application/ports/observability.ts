export type LogContext = Record<string, string | number | boolean | undefined>;

export interface LoggerPort {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
}

export interface MetricsPort {
  increment(name: string, value?: number): void;
  snapshot(): Record<string, number>;
}
