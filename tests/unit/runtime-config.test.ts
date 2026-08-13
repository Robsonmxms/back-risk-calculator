import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { describe, expect, it, vi } from "vitest";
import { AwsSecretsManagerConfigSource } from "../../src/04-infra/config/AwsSecretsManagerConfigSource";
import {
  createRuntimeConfigLoader,
  getConfigMetricsSnapshot,
  loadRuntimeConfigFromBootstrap,
  readBootstrapEnvironment
} from "../../src/04-infra/config/bootstrap";
import { ConfigError } from "../../src/04-infra/config/ConfigError";
import { EnvironmentConfigSource } from "../../src/04-infra/config/EnvironmentConfigSource";
import { InMemoryConfigSource } from "../../src/04-infra/config/InMemoryConfigSource";
import { parseRuntimeConfig } from "../../src/04-infra/config/RuntimeConfig";

const bootstrap = {
  stage: "test",
  port: 8000,
  awsRegion: "us-east-1"
};

function document() {
  return {
    schemaVersion: 1,
    auth: {
      accessTokenSecret: "test-only-access-token-secret-at-least-32-characters",
      accessTokenTtlSeconds: 900,
      refreshTokenTtlDays: 30
    },
    http: { corsAllowedOrigins: ["https://app.example.invalid"] },
    database: { url: "postgres://test:test@localhost:5432/test" },
    queues: { portfolioImports: { provider: "memory" } },
    providers: {}
  };
}

describe("centralized runtime configuration", () => {
  it("parses the versioned document and deeply freezes every namespace", () => {
    const config = parseRuntimeConfig(document(), bootstrap);

    expect(config.auth.accessTokenTtlSeconds).toBe(900);
    expect(config.runtime.stage).toBe("test");
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.auth)).toBe(true);
    expect(Object.isFrozen(config.queues.portfolioImports)).toBe(true);
    expect(() => {
      (config.auth as { accessTokenTtlSeconds: number }).accessTokenTtlSeconds = 1;
    }).toThrow();
  });

  it("rejects unsupported versions, invalid URLs, TTLs and inconsistent queues", () => {
    expect(() => parseRuntimeConfig({ ...document(), schemaVersion: 2 }, bootstrap)).toThrow(
      "config.schema_version_unsupported"
    );
    expect(() =>
      parseRuntimeConfig(
        {
          ...document(),
          auth: { ...document().auth, accessTokenTtlSeconds: 0 }
        },
        bootstrap
      )
    ).toThrow("config.secret_payload_invalid");
    expect(() =>
      parseRuntimeConfig(
        {
          ...document(),
          queues: { portfolioImports: { provider: "sqs" } }
        },
        bootstrap
      )
    ).toThrow("config.secret_payload_invalid");
    expect(() =>
      parseRuntimeConfig(
        {
          ...document(),
          http: { corsAllowedOrigins: ["not-an-origin"] }
        },
        bootstrap
      )
    ).toThrow("config.secret_payload_invalid");
    expect(() =>
      parseRuntimeConfig(document(), {
        ...bootstrap,
        stage: "production"
      })
    ).toThrow("config.secret_payload_invalid");
  });

  it("merges immutable deployment queue outputs before validating production config", () => {
    const config = parseRuntimeConfig(
      {
        ...document(),
        queues: { portfolioImports: { provider: "sqs" } }
      },
      {
        ...bootstrap,
        stage: "production",
        portfolioImportQueueUrl:
          "https://sqs.us-east-1.amazonaws.com/000000000000/portfolio-imports.fifo",
        portfolioImportDeadLetterQueueUrl:
          "https://sqs.us-east-1.amazonaws.com/000000000000/portfolio-imports-dlq.fifo"
      }
    );

    expect(config.queues.portfolioImports.provider).toBe("sqs");
    expect(config.queues.portfolioImports.queueUrl).toContain("portfolio-imports.fifo");
  });

  it("shares one in-flight source read across concurrent bootstrap consumers", async () => {
    const source = new InMemoryConfigSource(document());
    const load = createRuntimeConfigLoader({ source, bootstrap });

    const [first, second, third] = await Promise.all([load(), load(), load()]);

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(source.readCount()).toBe(1);
  });

  it("records bounded load duration for redacted validation failures", async () => {
    const source = new InMemoryConfigSource({ schemaVersion: 1 });
    const before = getConfigMetricsSnapshot()["config.load.duration_ms"] ?? 0;

    await expect(createRuntimeConfigLoader({ source, bootstrap })()).rejects.toThrow(
      "config.secret_payload_invalid"
    );

    expect(getConfigMetricsSnapshot()["config.load.failure"]).toBeGreaterThan(0);
    expect(getConfigMetricsSnapshot()["config.load.duration_ms"]).toBeGreaterThanOrEqual(before);
  });

  it("builds deterministic local documents from an explicit environment source", async () => {
    const source = new EnvironmentConfigSource({
      ACCESS_TOKEN_SECRET: "local-only-access-token-secret-at-least-32-characters",
      ACCESS_TOKEN_TTL_SECONDS: "1200",
      REFRESH_TOKEN_TTL_DAYS: "7",
      CORS_ALLOWED_ORIGINS: "https://app.example.invalid, https://admin.example.invalid",
      DATABASE_URL: "postgres://local:local@localhost:5432/local",
      PORTFOLIO_IMPORT_QUEUE_PROVIDER: "memory"
    });

    const config = await createRuntimeConfigLoader({ source, bootstrap })();

    expect(config.auth.accessTokenTtlSeconds).toBe(1200);
    expect(config.http.corsAllowedOrigins).toEqual([
      "https://app.example.invalid",
      "https://admin.example.invalid"
    ]);
  });

  it("requires Secrets Manager and a secret identifier in production-like stages", async () => {
    expect(() =>
      readBootstrapEnvironment({
        NODE_ENV: "production",
        APP_CONFIG_SOURCE: "environment"
      })
    ).toThrow("config.source_invalid");

    const values = readBootstrapEnvironment({ NODE_ENV: "staging" });
    expect(values.source).toBe("secrets-manager");
    expect(values.secretId).toBeUndefined();
    await expect(loadRuntimeConfigFromBootstrap(values)).rejects.toThrow(
      "config.secret_id_required"
    );
  });

  it("reads JSON through the AWS adapter and exposes only a hash of its identifier", async () => {
    const send = vi.fn(async (command: unknown) => {
      expect(command).toBeInstanceOf(GetSecretValueCommand);
      return { SecretString: JSON.stringify(document()), $metadata: {} };
    });
    const source = new AwsSecretsManagerConfigSource({ send } as never, "prod/platform/api");

    await expect(source.load()).resolves.toEqual(document());
    expect(source.safeIdentifier).not.toContain("prod/platform/api");
    expect(source.safeIdentifier).toHaveLength(12);
  });

  it("logs only the safe secret identifier hash after a successful load", async () => {
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const send = vi.fn(async () => ({
      SecretString: JSON.stringify(document()),
      $metadata: {}
    }));
    const source = new AwsSecretsManagerConfigSource({ send } as never, "prod/private/config-id");

    await createRuntimeConfigLoader({ source, bootstrap })();

    const serialized = output.mock.calls.flat().join(" ");
    expect(serialized).toContain(source.safeIdentifier);
    expect(serialized).not.toContain("prod/private/config-id");
    expect(serialized).not.toContain(document().auth.accessTokenSecret);
    output.mockRestore();
  });

  it.each([
    [
      "unavailable",
      async () => Promise.reject(new Error("AccessDenied: raw-provider-detail")),
      "config.secret_unavailable"
    ],
    ["empty", async () => ({ $metadata: {} }), "config.secret_payload_invalid"],
    [
      "binary",
      async () => ({ SecretBinary: new Uint8Array([1]), $metadata: {} }),
      "config.secret_payload_invalid"
    ],
    [
      "malformed",
      async () => ({ SecretString: "{not-json", $metadata: {} }),
      "config.secret_payload_invalid"
    ]
  ])("redacts AWS %s failures behind a stable code", async (_name, send, code) => {
    const source = new AwsSecretsManagerConfigSource({ send } as never, "sensitive/secret/id");

    const failure = await source.load().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ConfigError);
    expect((failure as Error).message).toBe(code);
    expect((failure as Error).message).not.toContain("sensitive/secret/id");
    expect((failure as Error).message).not.toContain("raw-provider-detail");
  });
});
