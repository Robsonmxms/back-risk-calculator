import path from "path";
import knex, { Knex } from "knex";

const DEFAULT_DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://risk_calculator:risk_calculator@127.0.0.1:5432/risk_calculator_dev";

export function createKnexClient(): Knex {
  return knex({
    client: "pg",
    connection: DEFAULT_DATABASE_URL,
    migrations: {
      directory: path.resolve(process.cwd(), "src/04-infra/database/migrations"),
      extension: "ts"
    }
  });
}

export function getDatabaseUrl(): string {
  return DEFAULT_DATABASE_URL;
}
