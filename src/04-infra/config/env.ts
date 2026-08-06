export interface AppConfig {
  nodeEnv: string;
  port: number;
  accessTokenSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  corsAllowedOrigins: string[];
  awsRegion: string;
  awsEndpoint?: string;
  portfolioImportQueueProvider: "memory" | "sqs";
  portfolioImportQueueUrl?: string;
  portfolioImportDeadLetterQueueUrl?: string;
}

const DEFAULT_DEV_ACCESS_TOKEN_SECRET = "dev-only-change-me-risk-calculator-access-token-secret";
const PRODUCTION_LIKE_ENVS = new Set(["production", "prod", "staging"]);

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const accessTokenSecret = process.env.ACCESS_TOKEN_SECRET ?? DEFAULT_DEV_ACCESS_TOKEN_SECRET;

  if (PRODUCTION_LIKE_ENVS.has(nodeEnv)) {
    if (!process.env.ACCESS_TOKEN_SECRET || accessTokenSecret === DEFAULT_DEV_ACCESS_TOKEN_SECRET) {
      throw new Error("config.access_token_secret_required");
    }
  }

  const portfolioImportQueueProvider = parseQueueProvider(
    process.env.PORTFOLIO_IMPORT_QUEUE_PROVIDER ??
      (PRODUCTION_LIKE_ENVS.has(nodeEnv) ? "sqs" : "memory")
  );
  const portfolioImportQueueUrl = process.env.PORTFOLIO_IMPORT_QUEUE_URL;
  const portfolioImportDeadLetterQueueUrl = process.env.PORTFOLIO_IMPORT_DLQ_URL;
  if (
    portfolioImportQueueProvider === "sqs" &&
    (!portfolioImportQueueUrl || !portfolioImportDeadLetterQueueUrl)
  ) {
    throw new Error("config.portfolio_import_sqs_urls_required");
  }
  if (PRODUCTION_LIKE_ENVS.has(nodeEnv) && portfolioImportQueueProvider !== "sqs") {
    throw new Error("config.portfolio_import_sqs_required");
  }

  return {
    nodeEnv,
    port: Number(process.env.PORT ?? 8000),
    accessTokenSecret,
    accessTokenTtlSeconds: Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? 900),
    refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
    corsAllowedOrigins: parseList(process.env.CORS_ALLOWED_ORIGINS),
    awsRegion: process.env.AWS_REGION ?? "us-east-1",
    awsEndpoint: process.env.AWS_ENDPOINT_URL,
    portfolioImportQueueProvider,
    portfolioImportQueueUrl,
    portfolioImportDeadLetterQueueUrl
  };
}

function parseQueueProvider(value: string): "memory" | "sqs" {
  if (value === "memory" || value === "sqs") return value;
  throw new Error("config.portfolio_import_queue_provider_invalid");
}

function parseList(value: string | undefined): string[] {
  return (
    value
      ?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean) ?? []
  );
}
