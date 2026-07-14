export interface AppConfig {
  nodeEnv: string;
  port: number;
  accessTokenSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  googleOAuthMockTokens: boolean;
}

export function loadConfig(): AppConfig {
  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    port: Number(process.env.PORT ?? 8000),
    accessTokenSecret:
      process.env.ACCESS_TOKEN_SECRET ??
      "dev-only-change-me-risk-calculator-access-token-secret",
    accessTokenTtlSeconds: Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? 900),
    refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
    googleOAuthMockTokens: process.env.GOOGLE_OAUTH_MOCK_TOKENS === "true"
  };
}
