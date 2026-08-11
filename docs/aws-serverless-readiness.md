# AWS Serverless Readiness

## Backend Packaging Targets

The existing `Dockerfile` produces a Node 26.5 standalone HTTP container suitable for a container
service such as ECS/Fargate or App Runner. It is not a Lambda container image: it does not use a
Lambda base image or runtime interface client.

The Serverless zip configuration keeps `nodejs20.x` only as a packaging smoke target because the
current Serverless v3 version does not accept newer managed Node runtimes. That target does not
match the declared Node 26 engine and is not an approved production runtime. A production Lambda
delivery must either add a Lambda-compatible Node 26 container/runtime path or intentionally align
the project engine and managed runtime after compatibility validation.

## Packaging

Serverless packaging must use compiled JavaScript:

```bash
yarn aws:package
```

The `serverless.yml` handler points to:

```text
dist/src/app.handler
```

Do not deploy `src/04-infra/serverless-bootstrap.cjs` or rely on `tsx/register` for production
Lambda execution.

## Runtime Configuration

Production-like stages are `prod`, `production`, and `staging`.

The API resolves one versioned configuration document before creating routers, workers or
listeners. Production-like stages use AWS Secrets Manager and fail startup unless these bootstrap
locators are available:

- `APP_CONFIG_SOURCE=secrets-manager`;
- `APP_CONFIG_SECRET_ID`, passed to `GetSecretValue`;
- `APP_CONFIG_SECRET_ARN`, used only by Serverless packaging to scope IAM;
- `NODE_ENV`, `PORT` and `AWS_REGION` deployment metadata.

The secret JSON uses `schemaVersion: 1` and the namespaces `auth`, `http`, `database`, `queues` and
`providers`. It contains the signing secret, TTLs, CORS origins, database URL and queue provider.
`serverless.yml` injects only the two provisioned FIFO queue URLs as a documented exception because
they are immutable CloudFormation outputs. Production-like stages never fall back to environment
payload fields.

Local development selects `APP_CONFIG_SOURCE=environment` explicitly and supplies the same
document fields through environment variables. Tests inject an in-memory source. The runtime source
scan allows `process.env` only in `src/04-infra/config/bootstrap.ts` and operator scripts.

The IAM role has only `secretsmanager:GetSecretValue` for the exact ARN supplied by
`APP_CONFIG_SECRET_ARN`; it cannot list secrets. Use the AWS credential provider chain and an
execution role—never static production AWS keys.

`CORS_ALLOWED_ORIGINS` is a comma-separated allowlist of exact frontend origins, for example:

```text
https://app.example.com,https://admin.example.com
```

The current CORS middleware also accepts HTTP origins on `localhost` and `127.0.0.1` regardless of
stage. A production-hardening change must scope that exception to local/test execution before this
behavior can be described as development-only.

## Rotation, Rollback And Diagnosis

- Rotate by creating a new secret version, validating it in staging and moving `AWSCURRENT`.
- Restart the process or trigger a Lambda cold start to adopt the current version. Runtime requests
  never poll Secrets Manager and the resolved object is deeply immutable.
- Roll back by moving `AWSCURRENT` to the last validated version and restarting/cold-starting.
- Diagnose with stable codes: `config.secret_id_required`, `config.secret_unavailable`,
  `config.secret_payload_invalid`, `config.schema_version_unsupported` and
  `config.source_invalid`.
- Logs expose only source kind, stage, schema version, duration and a short hash of the identifier;
  they never include the identifier, document, credentials or secret values.

Before a deployment, validate the JSON shape offline with deterministic non-production values and
confirm both `APP_CONFIG_SECRET_ID` and the exact `APP_CONFIG_SECRET_ARN` refer to the same secret.
Malformed, empty, binary, inaccessible or unsupported-version payloads fail before traffic starts.

## Current Runtime Limits

In-memory repositories, report storage, realtime fan-out, and most worker queues are not production
durable. Portfolio spreadsheet imports already publish/consume through an SQS FIFO queue with a
FIFO DLQ provisioned in `serverless.yml`; the remaining responsibilities must move to durable
AWS-backed adapters before production Lambda traffic:

- PostgreSQL through RDS Proxy for users, sessions, offices, clients, portfolios, ledger,
  analytics, reports, alerts, notifications, delivery, audit, realtime/outbox records, and jobs.
- SQS plus DLQs for market data, analytics, reports, alert evaluation, notification delivery, and
  outbox publishing; portfolio imports are already covered.
- EventBridge Scheduler for market-data ingestion.
- S3 for report objects, with metadata and authorization state persisted in PostgreSQL.
- API Gateway WebSocket, AppSync, or a separate realtime service for realtime delivery; REST
  polling remains the fallback.

## Initial Lambda Guardrails

The current Serverless API function uses:

- timeout: 28 seconds;
- memory: 1024 MB;
- reserved concurrency: 10;
- no-store cache headers on protected REST routes;
- explicit CORS allowlist support;
- `callbackWaitsForEmptyEventLoop = false` for connection reuse readiness.
