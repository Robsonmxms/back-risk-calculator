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

## Dados seed para desenvolvimento

Quando a aplicacao sobe com a store em memoria, estes usuarios ficam disponiveis:

- `admin@example.com`
- `analyst@example.com`
- `user@example.com`
- `other@example.com`

Senha padrao:

```text
Password123!
```

Contas seed:

- `acct_main`
- `acct_private`

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
yarn typecheck
yarn lint
yarn offline
```

`yarn offline` agora usa um bootstrap CommonJS em `src/04-infra/serverless-bootstrap.cjs` para
carregar o handler TypeScript real sem build previo.

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
