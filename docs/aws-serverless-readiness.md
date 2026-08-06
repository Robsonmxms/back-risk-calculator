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

## Current Runtime Configuration

Production-like stages are `prod`, `production`, and `staging`.

The implemented API reads configuration directly through `src/04-infra/config/env.ts`. In a
production-like stage it fails startup unless these values are available:

- `ACCESS_TOKEN_SECRET`, with a value different from the development fallback;
- `PORTFOLIO_IMPORT_QUEUE_URL`;
- `PORTFOLIO_IMPORT_DLQ_URL`.

`PORTFOLIO_IMPORT_QUEUE_PROVIDER` must resolve to `sqs`; `serverless.yml` sets it and injects the
two provisioned FIFO queue URLs. Production-like stages reject the development access-token secret
and the in-memory queue adapter.

Other current inputs are optional or operationally scoped:

- `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS`, `AWS_REGION`, and `AWS_ENDPOINT_URL` have
  local defaults or are optional;
- `CORS_ALLOWED_ORIGINS` is consumed by the API but does not currently fail startup when empty;
- `DATABASE_URL` is consumed by migration/seed commands and has a development-only local default;
  the normal API still uses process-local domain repositories and does not require PostgreSQL at
  startup.

`CORS_ALLOWED_ORIGINS` is a comma-separated allowlist of exact frontend origins, for example:

```text
https://app.example.com,https://admin.example.com
```

The current CORS middleware also accepts HTTP origins on `localhost` and `127.0.0.1` regardless of
stage. A production-hardening change must scope that exception to local/test execution before this
behavior can be described as development-only.

## Planned Secrets Manager Bootstrap

Root feature `1 - centralized-secrets-runtime-configuration` is specified but not implemented. Its
target is a single versioned configuration document loaded from AWS Secrets Manager, with only
bootstrap locators such as stage, region, port, source selector, and `APP_CONFIG_SECRET_ID` left in
deployment environment variables. `serverless.yml` does not yet grant
`secretsmanager:GetSecretValue` or configure that locator, so the current package must not be
described as Secrets Manager-backed.

After that feature is delivered, this section and `serverless.yml` must be updated together to
document least-privilege IAM, secret rotation, the validated document schema, and any queue URL
locator exception retained for generated infrastructure outputs.

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
