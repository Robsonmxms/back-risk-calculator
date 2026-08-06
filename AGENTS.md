# AGENTS.md

Guidance for AI agents working in the backend project.

## Backend Role

`back-risk-calculator` is the TypeScript + Express backend for the Investment Portfolio Analytics
Platform. Today it owns auth, session lifecycle, RBAC, current-user lookup, admin user listing,
account access, portfolio ledger, backend-owned market data ingestion, the first analytics risk
engine behavior, and local in-process reports, alerts, notifications, and realtime delivery.

The wider platform scope in root specs still exists as roadmap. Durable PostgreSQL runtime
repositories for every module, external worker/queue infrastructure, production object storage, and
hardened realtime operations are not implemented in this repository yet. Market-data, analytics,
and report workers currently run in-process through local containers/tests.

Specs are not local to this project. Before implementation, read the relevant root macro spec in
`../.specs/features/<feature>/`.

## Current Stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js 26.5.0+ |
| Language | TypeScript |
| API | Express 5 |
| Validation | Joi |
| Persistence in runtime | Empty-by-default in-memory stores across the implemented domain modules |
| Persistence prepared | PostgreSQL + Knex migrations/query builder |
| Auth | Password login, JWT access token, refresh token rotation |
| Market data | Backend provider adapters behind ports |
| Workers | In-process market-data, analytics, report, and alert-evaluation workers |
| Observability | Lightweight logger and metrics adapters |
| Containers | Docker Compose for API and PostgreSQL |
| Tests | Vitest and Supertest integration tests |

## Clean Architecture Rules

Use inward dependencies:

```text
04-infra -> 03-adapters -> 02-application -> 01-domain
```

- Routers parse HTTP, apply middleware/validation, call controllers, and map responses.
- Keep request/validation schemas in `src/03-adapters/schemas`, not in `controllers`. Schema files
  must follow the `DomainSchema.ts` pattern, such as `AuthSchema.ts`, `PortfolioSchema.ts`, or
  `OperationalChartSchema.ts`.
- Use cases own orchestration, policies, and security decisions.
- Domain rules must not import Express, Joi, or infrastructure adapters.
- Repository files expose contracts/ports. The current concrete implementation is an in-memory
  identity, portfolio, market-data, and analytics stores.

## Source Layout

```text
back-risk-calculator/
  src/
    01-domain/
      accounts/
      advisory/
      auth/
      clients/
      compliance/
      delivery/
      offices/
      portfolios/
      users/
      workbench/
    02-application/
      accounts/
      auth/
      clients/
      compliance/
      delivery/
      errors/
      offices/
      portfolios/
      ports/
      users/
      workbench/
    03-adapters/
      controllers/
      schemas/
      middlewares/
      observability/
      security/
    04-infra/
      config/
      container/
      database/
      repositories/
      routes/
      server.ts
    modules/
      analytics/
      market-data/
      reports-alerts/
    app.ts
  scripts/
  tests/
    integration/
```

## Implementation Rules

- Do not create `back-risk-calculator/.specs/`.
- Follow root macro specs for feature scope and acceptance criteria.
- Do not put business rules in Express routers, Joi schemas, or infrastructure entry points.
- Runtime startup must not seed users, offices, clients, accounts, portfolios, reports, alerts,
  notifications, audit events, assignments, quotes, analytics, or any other business records.
- Keep fake providers, seeded identity stores, and business fixtures in `tests/` helpers or
  explicit operator seed scripts only; never import them from app boot, containers, routers,
  controllers, or production providers.
- Keep README, `AGENTS.md`, and root specs aligned with the implemented API.
- Mock/fake external providers in tests.
- Avoid investment-advice language; the backend analyzes risk and explains metrics.
