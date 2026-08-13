# AGENTS.md

Guidance for AI agents working in the backend project.

## Backend Role

`back-risk-calculator` is the TypeScript + Express backend for the Investment Portfolio Analytics
Platform. Today it owns auth, session lifecycle, global/office/account authorization, current-user
lookup, hierarchical global user management, offices, clients, workbench, portfolios and ledger,
backend-owned market data, analytics and operational charts, asynchronous XLSX portfolio imports,
reports, alerts, notifications, compliance, report delivery, audit, client portal contracts, and
authorized realtime delivery.

The wider platform scope in root specs still exists as roadmap. Durable PostgreSQL runtime
repositories for every module, production object storage, and hardened realtime operations are not
implemented in this repository yet. Portfolio spreadsheet imports have an Amazon SQS FIFO/DLQ
adapter; market-data, analytics, and report workers still use in-process queues.

Centralized runtime configuration is implemented through one validated, immutable document with
AWS Secrets Manager required for production-like stages. Global identity management is implemented
through the canonical `/users` collection with role-scoped pagination and the
`admin > analyst > user` hierarchy, including create/edit operations, self-management denial,
last-active-admin protection, audit events, and session revocation after role/status changes.

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
| Workers | SQS-backed portfolio-import worker; remaining workers run in process |
| Observability | Lightweight logger and metrics adapters |
| Containers | Docker Compose for API, PostgreSQL, and LocalStack/SQS |
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
- Repository files expose contracts/ports. Most current concrete domain repositories are
  empty-by-default in-memory stores; portfolio-import delivery can use SQS outside local/test mode.
- `yarn architecture:check` enforces the source-root allowlist, inward dependency matrix, all
  TypeScript import/export forms, and a cycle-free production graph. It runs from lint, pre-commit,
  and CI.

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
      analytics/
      market-data/
      offices/
      portfolio-imports/
      portfolios/
      reports-alerts/
      users/
      workbench/
    02-application/
      accounts/
      auth/
      clients/
      compliance/
      delivery/
      analytics/
      errors/
      market-data/
      offices/
      portfolio-imports/
      portfolios/
      ports/
      reports-alerts/
      users/
      workbench/
    03-adapters/
      controllers/
      realtime/
      schemas/
      middlewares/
      observability/
      security/
    04-infra/
      analytics/
      config/
      container/
      database/
      market-data/
      portfolio-imports/
      providers/
      realtime/
      repositories/
      reports-alerts/
      routes/
      server.ts
    app.ts
  scripts/
  tests/
    integration/
```

## Implementation Rules

- Do not create `back-risk-calculator/.specs/`.
- `src` may contain only `01-domain`, `02-application`, `03-adapters`, `04-infra`, and `app.ts`.
- Place analytics, market-data, and reports/alerts code in the numbered layer matching its
  responsibility; `src/modules` and compatibility re-exports are forbidden.
- Follow root macro specs for feature scope and acceptance criteria.
- Treat global roles, office membership roles, account roles, and advisory permissions as distinct
  authorization dimensions.
- Configuration enters only through `src/04-infra/config/bootstrap.ts`. Do not add
  environment/secret reads to domain, application, controllers, routers, providers, workers or
  request paths; project immutable capability-specific settings at the composition boundary.
- Keep global identity management under the canonical `/users` contracts and the source-controlled
  hierarchy policy; do not reintroduce the removed `/admin/users` compatibility route.
- Do not put business rules in Express routers, Joi schemas, or infrastructure entry points.
- Runtime startup must not seed users, offices, clients, accounts, portfolios, reports, alerts,
  notifications, audit events, assignments, quotes, analytics, or any other business records.
- Keep fake providers, seeded identity stores, and business fixtures in `tests/` helpers or
  explicit operator seed scripts only; never import them from app boot, containers, routers,
  controllers, or production providers.
- Keep README, `AGENTS.md`, and root specs aligned with the implemented API.
- Mock/fake external providers in tests.
- Avoid investment-advice language; the backend analyzes risk and explains metrics.
