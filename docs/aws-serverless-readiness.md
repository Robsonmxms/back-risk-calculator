# AWS Serverless Readiness

## Backend Target

The current production-compatible target for the declared Node engine is a Lambda container image
based on the existing `Dockerfile` runtime stage (`node:26.5.0-alpine`). The Serverless zip config
keeps `nodejs20.x` only as a managed-runtime packaging smoke target because the local Serverless v3
version does not accept newer managed Node runtimes. Production deployments that must honor the
Node 26 engine should use the container path until AWS/tooling support aligns or the project
intentionally lowers its Node engine.

## Packaging

Serverless packaging must use compiled JavaScript:

```bash
yarn aws:package
```

The `serverless.js` handler points to:

```text
dist/src/04-infra/serverless.handler
```

Do not deploy `src/04-infra/serverless-bootstrap.cjs` or rely on `tsx/register` for production
Lambda execution.

## Required Runtime Configuration

Production-like stages are `prod`, `production`, and `staging`.

Required variables:

- `ACCESS_TOKEN_SECRET`
- `DATABASE_URL`
- `CORS_ALLOWED_ORIGINS`

Production-like stages reject the dev access-token secret and reject
`GOOGLE_OAUTH_MOCK_TOKENS=true`.

`CORS_ALLOWED_ORIGINS` is a comma-separated allowlist of exact frontend origins, for example:

```text
https://app.example.com,https://admin.example.com
```

Localhost and `127.0.0.1` remain allowed for local development.

## Current Runtime Limits

In-memory repositories, report storage, realtime fan-out, and worker queues are not production
durable. Before production Lambda traffic, these responsibilities must move to durable AWS-backed
adapters:

- PostgreSQL through RDS Proxy for users, sessions, offices, clients, portfolios, ledger,
  analytics, reports, alerts, notifications, delivery, audit, realtime/outbox records, and jobs.
- SQS plus DLQs for market data, analytics, reports, alert evaluation, notification delivery, and
  outbox publishing.
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
