import Joi from "joi";
import { ConfigError } from "./ConfigError";

export type PortfolioImportQueueProvider = "memory" | "sqs";

export interface RuntimeConfigDocumentV1 {
  schemaVersion: 1;
  auth: {
    accessTokenSecret: string;
    accessTokenTtlSeconds: number;
    refreshTokenTtlDays: number;
  };
  http: {
    corsAllowedOrigins: string[];
  };
  database: {
    url: string;
  };
  queues: {
    portfolioImports: {
      provider: PortfolioImportQueueProvider;
      queueUrl?: string;
      deadLetterQueueUrl?: string;
    };
  };
  providers: Record<string, unknown>;
}

export interface RuntimeBootstrapValues {
  stage: string;
  port: number;
  awsRegion: string;
  awsEndpoint?: string;
  portfolioImportQueueUrl?: string;
  portfolioImportDeadLetterQueueUrl?: string;
}

export interface RuntimeConfig extends RuntimeConfigDocumentV1 {
  runtime: {
    stage: string;
    port: number;
    awsRegion: string;
    awsEndpoint?: string;
  };
}

const documentSchema = Joi.object<RuntimeConfigDocumentV1>({
  schemaVersion: Joi.number().integer().valid(1).required(),
  auth: Joi.object({
    accessTokenSecret: Joi.string().min(32).required(),
    accessTokenTtlSeconds: Joi.number().integer().positive().max(86_400).required(),
    refreshTokenTtlDays: Joi.number().integer().positive().max(365).required()
  })
    .unknown(false)
    .required(),
  http: Joi.object({
    corsAllowedOrigins: Joi.array().items(Joi.string().uri()).unique().required()
  })
    .unknown(false)
    .required(),
  database: Joi.object({
    url: Joi.string().uri().required()
  })
    .unknown(false)
    .required(),
  queues: Joi.object({
    portfolioImports: Joi.object({
      provider: Joi.string().valid("memory", "sqs").required(),
      queueUrl: Joi.string().uri().optional(),
      deadLetterQueueUrl: Joi.string().uri().optional()
    })
      .unknown(false)
      .required()
  })
    .unknown(false)
    .required(),
  providers: Joi.object().unknown(true).required()
}).unknown(false);

export function parseRuntimeConfig(
  input: unknown,
  bootstrap: RuntimeBootstrapValues
): RuntimeConfig {
  if (
    !Number.isInteger(bootstrap.port) ||
    bootstrap.port < 1 ||
    bootstrap.port > 65_535 ||
    !bootstrap.stage ||
    !bootstrap.awsRegion ||
    (bootstrap.awsEndpoint && !isUrl(bootstrap.awsEndpoint))
  ) {
    throw new ConfigError("config.secret_payload_invalid");
  }
  if (!isRecord(input) || input.schemaVersion !== 1) {
    if (isRecord(input) && "schemaVersion" in input) {
      throw new ConfigError("config.schema_version_unsupported");
    }
    throw new ConfigError("config.secret_payload_invalid");
  }

  const document = mergeDeploymentOutputs(input, bootstrap);
  const result = documentSchema.validate(document, {
    abortEarly: false,
    allowUnknown: false,
    convert: false
  });
  if (result.error) {
    throw new ConfigError("config.secret_payload_invalid");
  }

  const parsed = result.value;
  const queue = parsed.queues.portfolioImports;
  const productionLike = ["production", "prod", "staging"].includes(bootstrap.stage);
  if (
    (queue.provider === "sqs" && (!queue.queueUrl || !queue.deadLetterQueueUrl)) ||
    (queue.provider === "memory" && (queue.queueUrl || queue.deadLetterQueueUrl)) ||
    (productionLike && queue.provider !== "sqs")
  ) {
    throw new ConfigError("config.secret_payload_invalid");
  }

  return deepFreeze({
    ...parsed,
    runtime: {
      stage: bootstrap.stage,
      port: bootstrap.port,
      awsRegion: bootstrap.awsRegion,
      ...(bootstrap.awsEndpoint ? { awsEndpoint: bootstrap.awsEndpoint } : {})
    }
  });
}

function mergeDeploymentOutputs(
  input: Record<string, unknown>,
  bootstrap: RuntimeBootstrapValues
): Record<string, unknown> {
  if (!bootstrap.portfolioImportQueueUrl && !bootstrap.portfolioImportDeadLetterQueueUrl) {
    return input;
  }

  const queues = isRecord(input.queues) ? input.queues : {};
  const portfolioImports = isRecord(queues.portfolioImports) ? queues.portfolioImports : {};
  return {
    ...input,
    queues: {
      ...queues,
      portfolioImports: {
        ...portfolioImports,
        ...(bootstrap.portfolioImportQueueUrl
          ? { queueUrl: bootstrap.portfolioImportQueueUrl }
          : {}),
        ...(bootstrap.portfolioImportDeadLetterQueueUrl
          ? { deadLetterQueueUrl: bootstrap.portfolioImportDeadLetterQueueUrl }
          : {})
      }
    }
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
