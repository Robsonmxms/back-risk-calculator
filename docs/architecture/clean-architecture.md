# Clean Architecture Boundaries

The backend source root contains only `01-domain`, `02-application`, `03-adapters`, `04-infra`, and
`app.ts`. Dependencies move inward: `app.ts -> 04-infra -> 03-adapters -> 02-application ->
01-domain`. The TypeScript-AST architecture check runs from lint, pre-commit, and CI and rejects
invalid roots, reverse dependencies, legacy paths, and production cycles.

The portfolio-import capability follows the same boundary: workbook values and job state live in
`01-domain/portfolio-imports`, orchestration and ports live in `02-application/portfolio-imports`,
HTTP mapping stays in adapters, and ExcelJS, in-memory delivery, and Amazon SQS implementations
stay in `04-infra/portfolio-imports`.

## Runtime Configuration Boundary

`src/04-infra/config/bootstrap.ts` is the only runtime module permitted to read `process.env`.
It selects an explicit local environment source or AWS Secrets Manager in production-like stages,
validates one namespaced `schemaVersion: 1` document and returns one deeply immutable
`RuntimeConfig`. The memoized in-flight promise is shared by HTTP, Serverless, workers and
containers; requests never fetch configuration.

`app.ts` projects the resolved configuration into narrow authentication, HTTP and SQS settings.
Domain and application modules do not depend on AWS SDKs, environment access or infrastructure
configuration types. `yarn architecture:check` enforces the approved environment reader and keeps
the Secrets Manager SDK restricted to `04-infra/config`.

## Legacy Module Migration Inventory

| Former `src/modules` source | Canonical numbered-layer destination | Responsibility |
| --- | --- | --- |
| `analytics/formulas.ts` | `01-domain/analytics/formulas.ts` | Pure risk formulas |
| `analytics/insights.ts` | `01-domain/analytics/insights.ts` | Pure explanatory policy |
| `analytics/sample-policy.ts` | `01-domain/analytics/sample-policy.ts` | Minimum-sample domain policy |
| `analytics/types.ts` | `01-domain/analytics/types.ts` | Domain values and analytics entities |
| `analytics/analyst-chart-types.ts` | `02-application/analytics/analyst-chart-types.ts` | Application read models |
| `analytics/chart-types.ts` | `02-application/analytics/chart-types.ts` | Portfolio chart query/read models |
| `analytics/ports.ts` | `02-application/analytics/ports.ts` | Repository and event ports |
| `analytics/analyst-chart-use-cases.ts` | `02-application/analytics/analyst-chart-use-cases.ts` | Analyst orchestration |
| `analytics/chart-use-cases.ts` | `02-application/analytics/chart-use-cases.ts` | Portfolio chart orchestration |
| `analytics/use-cases.ts` | `02-application/analytics/use-cases.ts` | Analytics orchestration |
| `analytics/worker.ts` | `04-infra/analytics/worker.ts` | Runtime worker delivery |
| `market-data/exchanges.ts` | `01-domain/market-data/exchanges.ts` | Exchange normalization policy |
| `market-data/freshness.ts` | `01-domain/market-data/freshness.ts` | Freshness policy |
| `market-data/types.ts` | `01-domain/market-data/types.ts` | Market-data domain values |
| `market-data/ports.ts` | `02-application/market-data/ports.ts` | Provider, repository, cache and queue ports |
| `market-data/use-cases.ts` | `02-application/market-data/use-cases.ts` | Market-data orchestration |
| `market-data/worker.ts` | `04-infra/market-data/worker.ts` | Runtime ingestion delivery |
| `reports-alerts/types.ts` | `01-domain/reports-alerts/types.ts` | Report, alert, notification and realtime values |
| `reports-alerts/access.ts` | `02-application/reports-alerts/access.ts` | Application access policy orchestration |
| `reports-alerts/ports.ts` | `02-application/reports-alerts/ports.ts` | Persistence, storage and event ports |
| `reports-alerts/use-cases.ts` | `02-application/reports-alerts/use-cases.ts` | Report/alert application behavior |
| `reports-alerts/worker.ts` | `04-infra/reports-alerts/worker.ts` | Runtime report and alert delivery |

The reports/alerts HTTP controller depends on the adapter-owned `RealtimeSubscriptionPort`; the
in-memory infrastructure hub supplies it structurally. Background workers depend on application
`LoggerPort` and `MetricsPort`, never concrete adapter classes.

Generated `.serverless/` content is ignored and reproducible. Hand-authored AWS configuration stays
in `serverless.yml`, whose package allowlist includes only compiled runtime output, runtime
dependencies, and required package metadata.
