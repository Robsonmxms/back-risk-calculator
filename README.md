# back-risk-calculator

API TypeScript + Express do Risk Calculator. O backend é a fonte de verdade para autenticação,
autorização, escritórios/clientes, contas, portfólios, dados de mercado, analytics, relatórios,
alertas, notificações, compliance, entrega e eventos SSE.

## Estado e arquitetura

- Node.js 26.5+, TypeScript, Express 5 e Joi.
- Clean Architecture: `04-infra -> 03-adapters -> 02-application -> 01-domain`.
- Stores e workers em processo para o runtime local.
- PostgreSQL/Knex preparado para migrações e seed operacional, ainda não usado como repositório
  durável por todos os módulos do runtime.
- Yahoo Finance como fonte primária de mercado/FX e Open ER API como fallback de FX, sempre atrás
  de portas do backend.
- Relatórios, alertas, notificações e SSE locais implementados; filas externas, object storage e
  realtime endurecido para produção permanecem no roadmap.

O bootstrap normal começa vazio: não cria identidades nem registros de negócio. Fixtures e fontes
determinísticas existem somente em testes ou no comando operacional explícito `dev:seeded`.

## API

Base local: `http://localhost:8000/api/v1` (`GET /health` fica fora do prefixo).

Os módulos de rota implementados cobrem:

- autenticação por senha, refresh rotativo, logout e ator atual;
- usuários administrativos, contas e autorização por conta;
- escritórios, permissões, operações e gráficos operacionais;
- clientes, grupos familiares, assignments e workbench;
- portfólios, ledger, posições, snapshots e idempotência;
- busca/cotação/histórico de mercado, exchanges, FX, refresh e status de providers;
- analytics, recomputação, snapshots, qualidade de dados e diagnósticos;
- relatórios/downloads, alertas, notificações e SSE autorizado;
- compliance, auditoria, revisões e entrega/portal de relatórios.

Datas de calendário usam `YYYY-MM-DD`; instantes usam RFC 3339. Métricas anualizadas e de risco
sensíveis a amostra exigem 30 retornos e 30 dias de horizonte na versão
`risk-v2-minimum-sample`. Cotações são frescas por 15 minutos e snapshots analíticos por 24 horas;
as respostas preservam origem e idade em vez de tratar sucesso do worker como sinônimo de frescor.

## Execução local

```bash
nvm use
corepack enable
yarn install
yarn dev
```

Modos distintos:

- `yarn dev`: API normal, vazia, com adapters reais configurados;
- `yarn dev:seeded`: massa determinística explícita para QA manual, nunca importada pelo boot normal;
- `yarn smoke:fx:real`: consulta operacional USD/BRL sem login e imprime provider, taxa, `asOf`,
  `updatedAt`, freshness e idade da fonte. Requer rede e não faz parte do CI determinístico.

O modo seeded usa as identidades canônicas documentadas em `tests/helpers/seededIdentityStore.ts`
e a senha de QA `Password123!`. Seus retornos de mercado aparecem como fonte determinística, não
como cotação atual.

Banco local preparado:

```bash
docker compose up -d postgres
yarn db:migrate:dev
yarn db:seed:dev
```

Esses comandos não substituem os stores em memória do bootstrap atual.

## Qualidade

```bash
yarn check:runtime-data
yarn lint
yarn typecheck
yarn test
yarn test:risk
yarn test:coverage
yarn build
```

`test:risk` protege os ramos críticos de amostra/freshness, adapters Yahoo/fallback, autorização,
market data e SSE. `test:coverage` exige 80% de statements/functions/lines e 55% de branches no
escopo configurado. Testes usam Vitest e Supertest e não dependem da internet.

## Estrutura

```text
src/
  01-domain/        entidades e regras de domínio
  02-application/   auth, contas, clientes, escritórios, portfólios, workbench, compliance e entrega
  03-adapters/      controllers, schemas Joi, middlewares, segurança e observabilidade
  04-infra/         containers, stores, providers, rotas, banco e entrypoints
  modules/          analytics, market-data e reports-alerts
scripts/            boot seeded, banco, guards e smokes operacionais
tests/              helpers, unitários e integrações
```

Veja também [prontidão AWS](docs/aws-serverless-readiness.md) e
[branch protection](docs/branch-protection.md). Licença MIT em [LICENSE](LICENSE).
