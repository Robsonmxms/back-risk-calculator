export interface AppConfig {
  nodeEnv: string;
  port: number;
  accessTokenSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  googleOAuthMockTokens: boolean;
  corsAllowedOrigins: string[];
}

const DEFAULT_DEV_ACCESS_TOKEN_SECRET =
  "dev-only-change-me-risk-calculator-access-token-secret";
const PRODUCTION_LIKE_ENVS = new Set(["production", "prod", "staging"]);

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const accessTokenSecret =
    process.env.ACCESS_TOKEN_SECRET ?? DEFAULT_DEV_ACCESS_TOKEN_SECRET;
  const googleOAuthMockTokens = process.env.GOOGLE_OAUTH_MOCK_TOKENS === "true";

  if (PRODUCTION_LIKE_ENVS.has(nodeEnv)) {
    if (!process.env.ACCESS_TOKEN_SECRET || accessTokenSecret === DEFAULT_DEV_ACCESS_TOKEN_SECRET) {
      throw new Error("config.access_token_secret_required");
    }

    if (googleOAuthMockTokens) {
      throw new Error("config.google_oauth_mock_tokens_forbidden");
    }
  }

  return {
    nodeEnv,
    port: Number(process.env.PORT ?? 8000),
    accessTokenSecret,
    accessTokenTtlSeconds: Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? 900),
    refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
    googleOAuthMockTokens,
    corsAllowedOrigins: parseList(process.env.CORS_ALLOWED_ORIGINS)
  };
}

function parseList(value: string | undefined): string[] {
  return (
    value
      ?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean) ?? []
  );
}
