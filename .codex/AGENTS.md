# AGENTS.md

Guidance for AI agents working in the backend project.

## Backend Role

`back-risk-calculator` is the TypeScript + Express backend for the Investment Portfolio Analytics
Platform. Today it owns auth, session lifecycle, RBAC, current-user lookup, admin user listing,
and account-level analytics summary behavior.

The wider platform scope in root specs still exists as roadmap, but workers, queues, market data
ingestion, reports, alerts, and realtime are not implemented in this repository yet.

Specs are not local to this project. Before implementation, read the relevant root macro spec in
`../.specs/features/<feature>/`.

## Current Stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js 26.5.0+ |
| Language | TypeScript |
| API | Express 5 |
| Validation | Joi |
| Persistence in runtime | In-memory identity/session store |
| Persistence prepared | PostgreSQL + Knex migrations/query builder |
| Auth | JWT access token, refresh token rotation, Google OAuth |
| Observability | Lightweight logger and metrics adapters |
| Containers | Docker Compose for API and PostgreSQL |
| Tests | Vitest and Supertest integration tests |

## Clean Architecture Rules

Use inward dependencies:

```text
04-infra -> 03-adapters -> 02-application -> 01-domain
```

- Routers parse HTTP, apply middleware/validation, call controllers, and map responses.
- Use cases own orchestration, policies, and security decisions.
- Domain rules must not import Express, Joi, or infrastructure adapters.
- Repository files expose contracts/ports. The current concrete implementation is an in-memory
  identity store.

## Source Layout

```text
back-risk-calculator/
  src/
    01-domain/
      accounts/
      auth/
      users/
    02-application/
      accounts/
      auth/
      errors/
      ports/
      users/
    03-adapters/
      controllers/
      middlewares/
      oauth/
      observability/
      security/
    04-infra/
      config/
      container/
      database/
      repositories/
      routes/
      server.ts
    app.ts
  scripts/
  tests/
    integration/
```

## Implementation Rules

- Do not create `back-risk-calculator/.specs/`.
- Follow root macro specs for feature scope and acceptance criteria.
- Do not put business rules in Express routers, Joi schemas, or infrastructure entry points.
- Keep README, `.codex/AGENTS.md`, and auth-related root specs aligned with the implemented API.
- Mock/fake external providers in tests.
- Avoid investment-advice language; the backend analyzes risk and explains metrics.
