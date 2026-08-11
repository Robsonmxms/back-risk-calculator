import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { AwsSecretsManagerConfigSource } from "./AwsSecretsManagerConfigSource";
import { ConfigError } from "./ConfigError";
import { ConfigSource } from "./ConfigSource";
import { EnvironmentConfigSource } from "./EnvironmentConfigSource";
import { parseRuntimeConfig, RuntimeBootstrapValues, RuntimeConfig } from "./RuntimeConfig";

type ConfigSourceSelection = "environment" | "secrets-manager";

export interface BootstrapEnvironment extends RuntimeBootstrapValues {
  source: ConfigSourceSelection;
  secretId?: string;
  environment: Readonly<Record<string, string | undefined>>;
}

export interface RuntimeConfigLoaderOptions {
  source: ConfigSource;
  bootstrap: RuntimeBootstrapValues;
}

const configMetrics = new Map<string, number>();
let defaultRuntimeConfigPromise: Promise<RuntimeConfig> | undefined;

export function loadRuntimeConfig(): Promise<RuntimeConfig> {
  defaultRuntimeConfigPromise ??= loadFromBootstrap(readBootstrapEnvironment());
  return defaultRuntimeConfigPromise;
}

export function loadRuntimeConfigFromBootstrap(
  bootstrap: BootstrapEnvironment
): Promise<RuntimeConfig> {
  return loadFromBootstrap(bootstrap);
}

export function createRuntimeConfigLoader(
  options: RuntimeConfigLoaderOptions
): () => Promise<RuntimeConfig> {
  let promise: Promise<RuntimeConfig> | undefined;
  return () => {
    promise ??= resolveRuntimeConfig(options);
    return promise;
  };
}

export function getConfigMetricsSnapshot(): Readonly<Record<string, number>> {
  return Object.freeze(Object.fromEntries(configMetrics.entries()));
}

export function readBootstrapEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env
): BootstrapEnvironment {
  const stage = environment.NODE_ENV ?? "development";
  const productionLike = ["production", "prod", "staging"].includes(stage);
  const selected =
    environment.APP_CONFIG_SOURCE ?? (productionLike ? "secrets-manager" : "environment");
  if (selected !== "environment" && selected !== "secrets-manager") {
    throw new ConfigError("config.source_invalid");
  }
  if (productionLike && selected !== "secrets-manager") {
    throw new ConfigError("config.source_invalid");
  }

  return {
    stage,
    port: Number(environment.PORT ?? 8000),
    source: selected,
    secretId: environment.APP_CONFIG_SECRET_ID,
    awsRegion: environment.AWS_REGION ?? "us-east-1",
    awsEndpoint: environment.AWS_ENDPOINT_URL,
    portfolioImportQueueUrl: environment.PORTFOLIO_IMPORT_QUEUE_URL,
    portfolioImportDeadLetterQueueUrl: environment.PORTFOLIO_IMPORT_DLQ_URL,
    environment
  };
}

async function loadFromBootstrap(bootstrap: BootstrapEnvironment): Promise<RuntimeConfig> {
  const source = buildSource(bootstrap);
  return resolveRuntimeConfig({ source, bootstrap });
}

function buildSource(bootstrap: BootstrapEnvironment): ConfigSource {
  if (bootstrap.source === "environment") {
    return new EnvironmentConfigSource(bootstrap.environment);
  }
  if (!bootstrap.secretId) {
    throw new ConfigError("config.secret_id_required");
  }
  return new AwsSecretsManagerConfigSource(
    new SecretsManagerClient({
      region: bootstrap.awsRegion,
      endpoint: bootstrap.awsEndpoint
    }),
    bootstrap.secretId
  );
}

async function resolveRuntimeConfig(options: RuntimeConfigLoaderOptions): Promise<RuntimeConfig> {
  const startedAt = Date.now();
  try {
    const document = await options.source.load();
    const config = parseRuntimeConfig(document, options.bootstrap);
    increment("config.load.success");
    increment("config.load.duration_ms", Date.now() - startedAt);
    process.stdout.write(
      `${JSON.stringify({
        level: "info",
        message: "config.loaded",
        source: options.source.kind,
        stage: options.bootstrap.stage,
        schemaVersion: config.schemaVersion,
        durationMs: Date.now() - startedAt,
        ...(options.source.safeIdentifier
          ? { secretIdentifierHash: options.source.safeIdentifier }
          : {})
      })}\n`
    );
    return config;
  } catch (error) {
    const code = error instanceof ConfigError ? error.code : "config.secret_unavailable";
    increment("config.load.failure");
    increment(`config.load.failure.${code}`);
    increment("config.load.duration_ms", Date.now() - startedAt);
    throw error instanceof ConfigError ? error : new ConfigError("config.secret_unavailable");
  }
}

function increment(metric: string, value = 1): void {
  configMetrics.set(metric, (configMetrics.get(metric) ?? 0) + value);
}
