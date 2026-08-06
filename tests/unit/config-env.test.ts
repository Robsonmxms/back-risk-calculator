import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

describe("loadConfig", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.ACCESS_TOKEN_SECRET;
    delete process.env.CORS_ALLOWED_ORIGINS;
    delete process.env.NODE_ENV;
    delete process.env.PORTFOLIO_IMPORT_QUEUE_PROVIDER;
    delete process.env.PORTFOLIO_IMPORT_QUEUE_URL;
    delete process.env.PORTFOLIO_IMPORT_DLQ_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("keeps development defaults and parses comma-separated CORS origins", async () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com, https://admin.example.com ,,";
    process.env.PORTFOLIO_IMPORT_QUEUE_PROVIDER = "memory";

    const { loadConfig } = await import("../../src/04-infra/config/env.js");

    expect(loadConfig()).toMatchObject({
      nodeEnv: "development",
      corsAllowedOrigins: ["https://app.example.com", "https://admin.example.com"]
    });
  });

  it("rejects production-like runtimes without a real access token secret", async () => {
    process.env.NODE_ENV = "prod";

    const { loadConfig } = await import("../../src/04-infra/config/env.js");

    expect(() => loadConfig()).toThrow("config.access_token_secret_required");
  });

  it("requires SQS and both queue URLs in production-like runtimes", async () => {
    process.env.NODE_ENV = "production";
    process.env.ACCESS_TOKEN_SECRET = "production-secret";

    const { loadConfig } = await import("../../src/04-infra/config/env.js");

    expect(() => loadConfig()).toThrow("config.portfolio_import_sqs_urls_required");

    process.env.PORTFOLIO_IMPORT_QUEUE_PROVIDER = "memory";
    expect(() => loadConfig()).toThrow("config.portfolio_import_sqs_required");
  });
});
