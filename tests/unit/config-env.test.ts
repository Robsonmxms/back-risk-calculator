import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

describe("loadConfig", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.ACCESS_TOKEN_SECRET;
    delete process.env.CORS_ALLOWED_ORIGINS;
    delete process.env.GOOGLE_OAUTH_MOCK_TOKENS;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("keeps development defaults and parses comma-separated CORS origins", async () => {
    process.env.CORS_ALLOWED_ORIGINS =
      "https://app.example.com, https://admin.example.com ,,";

    const { loadConfig } = await import("../../src/04-infra/config/env.js");

    expect(loadConfig()).toMatchObject({
      nodeEnv: "development",
      googleOAuthMockTokens: false,
      corsAllowedOrigins: ["https://app.example.com", "https://admin.example.com"]
    });
  });

  it("rejects production-like runtimes without a real access token secret", async () => {
    process.env.NODE_ENV = "prod";

    const { loadConfig } = await import("../../src/04-infra/config/env.js");

    expect(() => loadConfig()).toThrow("config.access_token_secret_required");
  });

  it("rejects Google OAuth mock tokens in production-like runtimes", async () => {
    process.env.NODE_ENV = "staging";
    process.env.ACCESS_TOKEN_SECRET = "staging-secret";
    process.env.GOOGLE_OAUTH_MOCK_TOKENS = "true";

    const { loadConfig } = await import("../../src/04-infra/config/env.js");

    expect(() => loadConfig()).toThrow("config.google_oauth_mock_tokens_forbidden");
  });
});
