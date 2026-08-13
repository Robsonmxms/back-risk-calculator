import {
  parseRuntimeConfig,
  RuntimeConfig,
  RuntimeConfigDocumentV1
} from "../../src/04-infra/config/RuntimeConfig";

export function createTestRuntimeConfig(
  overrides: Partial<RuntimeConfigDocumentV1> = {}
): RuntimeConfig {
  return parseRuntimeConfig(
    {
      schemaVersion: 1,
      auth: {
        accessTokenSecret: "test-only-access-token-secret-at-least-32-characters",
        accessTokenTtlSeconds: 900,
        refreshTokenTtlDays: 30
      },
      http: { corsAllowedOrigins: [] },
      database: { url: "postgres://test:test@127.0.0.1:5432/risk_calculator_test" },
      queues: { portfolioImports: { provider: "memory" } },
      providers: {},
      ...overrides
    },
    {
      stage: "test",
      port: 8000,
      awsRegion: "us-east-1"
    }
  );
}
