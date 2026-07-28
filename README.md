# back-risk-calculator

Backend em TypeScript + Express do Risk Calculator. No estado atual, este projeto implementa
autenticacao, sessao com refresh token rotativo, RBAC e um endpoint protegido de resumo de
analytics por conta.

## Estado atual

O backend ja possui codigo executavel, testes e rotas HTTP. O escopo implementado hoje e:

- login por email/senha;
- login Google via verificador configuravel;
- refresh de sessao com rotacao de refresh token;
- logout com revogacao do token ativo;
- identificacao do usuario autenticado;
- RBAC para rotas globais e por conta;
- listagem administrativa de usuarios;
- resumo de analytics por conta;
- health check em `/health`.

Persistencia de identidade e sessoes ainda esta em memoria via
`src/04-infra/repositories/InMemoryIdentityStore.ts`. O projeto ja contem migracao Knex e
`DATABASE_URL` no `docker-compose.yml`, mas a API local ainda nao grava usuarios, memberships ou
refresh tokens no PostgreSQL.

## Stack atual

| Camada | Tecnologia |
| --- | --- |
| Runtime | Node.js 26.5.0+ |
| Linguagem | TypeScript |
| API | Express 5 |
| Validacao | Joi |
| Persistencia atual | Store em memoria |
| Persistencia preparada | PostgreSQL + Knex |
| Auth | JWT, refresh token rotation, Google OAuth configuravel |
| Execucao local | `tsx watch` |
| Serverless | `serverless` + `serverless-offline` |
| Testes | Vitest + Supertest |
| Pacotes | Yarn 4.17.1 via `packageManager` |

## Rotas disponiveis

Base local:

```text
http://localhost:8000/api/v1
```

Rotas implementadas:

- `POST /auth/login`
- `POST /auth/google`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /users/me`
- `GET /admin/users`
- `GET /accounts/:accountId/analytics/summary`

## Caminho de QA local

O bootstrap normal da API nao popula registros de negocio. Isso evita que o runtime local ou
produtivo dependa de fixtures acopladas ao boot da aplicacao.

Para QA automatizado, os testes usam `tests/helpers/createSeededTestApp` e
`tests/helpers/seededIdentityStore.ts`. Esse caminho e explicito, test-only e cobre login,
usuario atual, RBAC, portfolio ledger, analytics, market data, reports, alerts, notifications,
delivery, compliance e workbench sem importar seed para `src/`.

Usuarios disponiveis no helper de QA:

- `admin@risk.local`
- `analyst@risk.local`
- `advisor@example.com`
- `assistant@example.com`
- `client@example.com`
- `user@risk.local`
- `other@risk.local`

Senha padrao do helper:

```text
Password123!
```

Contas e portfolios principais do helper:

- `acct_main`
- `acct_income`
- `prt_main`

## Estrutura do projeto

```text
back-risk-calculator/
  src/
    01-domain/
    02-application/
    03-adapters/
    04-infra/
    app.ts
  scripts/
  tests/
    integration/
```

Direcao de dependencias:

```text
04-infra -> 03-adapters -> 02-application -> 01-domain
```

## Desenvolvimento local

Use Node e Yarn nas versoes do projeto:

```bash
nvm use
corepack enable
yarn install
yarn dev
```

Use `yarn` para instalar dependencias e executar scripts; o projeto declara `packageManager`
como `yarn@4.17.1` e usa `nodeLinker: node-modules`.

Comandos uteis:

```bash
yarn test
yarn test:coverage
yarn typecheck
yarn lint
yarn aws:package
yarn offline
```

`yarn test:coverage` usa Vitest com provider `v8`. O gate atual exige no minimo 80% de
statements, functions e lines no codigo coberto pelo projeto, e trava branch coverage em 55% para
impedir regressao abaixo do baseline existente. O baseline de branches medido nesta etapa foi
56.97%; elevar esse indicador para 80% exige expansao dedicada de testes de ramificacao.

`yarn offline` e `yarn aws:package` compilam TypeScript antes de chamar Serverless. A
configuracao Serverless aponta para `dist/src/04-infra/serverless.handler`; o bootstrap com
`tsx/register` fica apenas como legado local e nao deve ser usado em Lambda de producao.

Detalhes do alvo AWS, runtime Node, CORS, variaveis obrigatorias, limites atuais e responsabilidades
que ainda precisam sair da memoria estao em [docs/aws-serverless-readiness.md](docs/aws-serverless-readiness.md).

Docker:

```bash
docker build --target dev -t back-risk-calculator:dev .
docker run --rm -p 8000:8000 back-risk-calculator:dev
```

Compose do projeto:

```bash
docker compose up --build
```

Scripts de banco atualmente disponiveis:

```bash
docker compose up -d postgres
yarn db:migrate:dev
yarn db:seed:dev
```

Esses scripts preparam o PostgreSQL local, mas nao substituem a store em memoria usada pela API
no bootstrap atual da aplicacao.

Use esses scripts para smoke manual de migracao/seed quando o PostgreSQL local estiver ativo. Se
`docker compose up -d postgres` nao estiver rodando, `yarn db:migrate:dev` falha com
`ECONNREFUSED 127.0.0.1:5432`.

## Variaveis de ambiente

- `PORT`
- `ACCESS_TOKEN_SECRET`
- `ACCESS_TOKEN_TTL_SECONDS`
- `REFRESH_TOKEN_TTL_DAYS`
- `GOOGLE_OAUTH_MOCK_TOKENS`

## Testes e comportamento validado

Os testes de integracao cobrem:

- login com credenciais validas e invalidas;
- refresh token rotativo;
- revogacao de familia de refresh tokens quando ha reuse;
- logout com revogacao do token;
- retorno seguro de `/users/me`;
- bloqueio de rota admin para nao-admin;
- autorizacao por conta em `/accounts/:accountId/analytics/summary`.

## Licenca

Distribuido sob a licenca MIT. Veja [LICENSE](LICENSE).
