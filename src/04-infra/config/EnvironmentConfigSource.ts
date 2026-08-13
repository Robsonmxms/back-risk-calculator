import { ConfigSource } from "./ConfigSource";

export class EnvironmentConfigSource implements ConfigSource {
  readonly kind = "environment" as const;

  constructor(private readonly environment: Readonly<Record<string, string | undefined>>) {}

  async load(): Promise<unknown> {
    return {
      schemaVersion: 1,
      auth: {
        accessTokenSecret: this.environment.ACCESS_TOKEN_SECRET,
        accessTokenTtlSeconds: parseNumber(this.environment.ACCESS_TOKEN_TTL_SECONDS, 900),
        refreshTokenTtlDays: parseNumber(this.environment.REFRESH_TOKEN_TTL_DAYS, 30)
      },
      http: {
        corsAllowedOrigins: parseList(this.environment.CORS_ALLOWED_ORIGINS)
      },
      database: {
        url: this.environment.DATABASE_URL
      },
      queues: {
        portfolioImports: {
          provider: this.environment.PORTFOLIO_IMPORT_QUEUE_PROVIDER ?? "memory",
          ...(this.environment.PORTFOLIO_IMPORT_QUEUE_URL
            ? { queueUrl: this.environment.PORTFOLIO_IMPORT_QUEUE_URL }
            : {}),
          ...(this.environment.PORTFOLIO_IMPORT_DLQ_URL
            ? { deadLetterQueueUrl: this.environment.PORTFOLIO_IMPORT_DLQ_URL }
            : {})
        }
      },
      providers: {}
    };
  }
}

function parseNumber(value: string | undefined, fallback: number): number {
  return value === undefined ? fallback : Number(value);
}

function parseList(value: string | undefined): string[] {
  return (
    value
      ?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean) ?? []
  );
}
