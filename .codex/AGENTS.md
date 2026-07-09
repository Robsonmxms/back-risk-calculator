# AGENTS.md

Guidance for AI agents working in the backend project.

## Backend Role

`back-risk-calculator` is the TypeScript + Express backend for the Investment Portfolio Analytics Platform. It
owns domain rules, auth, RBAC, market data ingestion, analytics, event publishing, workers,
reports, alerts, persistence, and observability.

Specs are not local to this project. Before implementation, read the relevant root macro spec in
`../.specs/features/<feature>/`.

## Planned Stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js LTS |
| Language | TypeScript |
| API | Express |
| Validation | Joi |
| Database | PostgreSQL + Knex migrations/query builder |
| Cache | Redis |
| Async processing | Local queue abstraction, AWS SQS/SNS-ready adapters |
| File storage | S3-compatible storage |
| Auth | JWT access token, refresh token rotation, Google OAuth |
| Observability | OpenTelemetry, structured logs, Prometheus metrics |
| Containers | Docker Compose for API, workers, Postgres, Redis, Prometheus, Grafana |
| Tests | Vitest, Supertest, factories, integration tests, contract tests |

## Clean Architecture Rules

Use inward dependencies:

```text
api      -> modules/services -> domain rules
workers  -> modules/services -> domain rules
infra    -> repository/provider ports
```

- Routers parse HTTP, apply middleware/validation, call services, and map responses.
- Services/use cases own orchestration, policies, transaction boundaries, and events.
- Domain rules/formulas must not import Express, Joi, Knex, Redis, AWS SDK clients, or provider SDKs.
- Repository files expose contracts/ports. Concrete database implementations use Knex behind those ports.
- Workers are thin queue/scheduler entry points and must call services/use cases.

## Expected Source Layout

```text
back-risk-calculator/
  src/
    api/
      auth/
      admin/
      portfolios/
      analytics/
      reports/
    modules/
      accounts/
        schema.ts
        service.ts
        repository.ts
        events.ts
      portfolios/
      market-data/
      analytics/
      reports/
      notifications/
    infra/
      db/
      repositories/
      providers/
      cache/
      queues/
      storage/
      observability/
    middlewares/
    workers/
    app.ts
    config.ts
  tests/
    unit/
    integration/
    contract/
```

## Implementation Rules

- Do not create `back-risk-calculator/.specs/`.
- Follow root macro specs for feature scope and acceptance criteria.
- Do not put business rules in Express routers, Joi schemas, Knex query builders, or worker entry points.
- Use Unit of Work/outbox for operations that persist data and publish events.
- Use provider adapters behind `MarketDataProvider`.
- Mock/fake external providers in tests.
- Add structured logs, metrics, and trace context to async flows.
- Avoid investment-advice language; the backend analyzes risk and explains metrics.

