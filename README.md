# back-risk-calculator

Backend TypeScript + Express do Risk Calculator, uma plataforma de analytics de portfolios de
investimento. Este projeto e a fonte de verdade para regras de dominio, autenticacao,
autorizacao, dados de mercado, calculos de risco, eventos, workers, relatorios, alertas,
persistencia e observabilidade.

## Estado atual

Este diretorio esta em fase de bootstrap. Antes de implementar codigo, leia:

- [Guia do projeto](.codex/AGENTS.md)
- [Contexto do workspace](../.specs/context.md)
- [Visao de produto](../.specs/product/vision.md)
- [Arquitetura](../.specs/architecture/overview.md)
- [Convencoes de API](../.specs/api/conventions.md)
- A macro spec da feature em `../.specs/features/<feature>/`

As specs vivem apenas na raiz do workspace. Nao crie `back-risk-calculator/.specs/`.

## Responsabilidades

- Expor APIs REST versionadas para auth, portfolios, analytics, market data, reports e alerts.
- Validar requests e mapear responses no envelope padrao `{ "data": ..., "meta": ... }`.
- Aplicar RBAC, politicas de seguranca e regras de dominio no backend.
- Persistir usuarios, portfolios, transacoes, ativos, precos historicos, snapshots e outbox.
- Ingerir dados de mercado por adapters atras de uma porta `MarketDataProvider`.
- Processar tarefas lentas com filas, workers, schedulers e eventos.
- Calcular metricas como retorno, drawdown, volatilidade, beta, Sharpe, concentracao,
  exposicao setorial e correlacao.
- Gerar relatorios, notificacoes e eventos realtime consumidos pelo frontend.
- Publicar logs estruturados, metricas e traces.

## Stack planejada

| Camada | Tecnologia |
| --- | --- |
| Runtime | Node.js LTS |
| Linguagem | TypeScript |
| API | Express |
| Validacao | Joi |
| Banco | PostgreSQL + Knex |
| Cache | Redis |
| Async | Filas locais com adapters prontos para AWS SQS/SNS |
| Storage | S3 compativel |
| Auth | JWT, refresh token rotation, Google OAuth |
| Observabilidade | OpenTelemetry, logs estruturados, Prometheus |
| Testes | Vitest, Supertest, integration e contract tests |

## Arquitetura esperada

Use dependencias apontando para dentro:

```text
api      -> modules/services -> domain rules
workers  -> modules/services -> domain rules
infra    -> repository/provider ports
```

Layout esperado:

```text
back-risk-calculator/
  src/
    api/
    modules/
    infra/
    middlewares/
    workers/
    app.ts
    config.ts
  tests/
    unit/
    integration/
    contract/
```

## Desenvolvimento local

O scaffold de aplicacao ainda nao foi criado. Quando existir `package.json`, os comandos
esperados devem seguir este formato:

```bash
npm install
npm run dev
npm test
```

A API local planejada e:

```text
http://localhost:8000/api/v1
```

## Regras importantes

- Nao coloque regra de negocio em routers, schemas Joi, query builders Knex ou entry points de workers.
- Use Unit of Work/outbox para operacoes que persistem dados e publicam eventos.
- Mocke provedores externos em testes.
- Nao registre senhas, tokens, credenciais, chaves de API ou dados sensiveis em logs.
- Evite linguagem de recomendacao financeira; o sistema analisa risco e explica metricas.

## Licenca

Distribuido sob a licenca MIT. Veja [LICENSE](LICENSE).
