import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("analytics_jobs", (table) => {
    table.uuid("id").primary();
    table.uuid("portfolio_id").notNullable().references("portfolios.id").onDelete("CASCADE");
    table.string("requested_by").notNullable();
    table.string("correlation_id").notNullable();
    table.enu("status", ["queued", "running", "succeeded", "failed"]).notNullable();
    table.integer("attempts").notNullable().defaultTo(0);
    table.string("error_code");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("completed_at");
    table.index(["portfolio_id", "status"]);
    table.index(["correlation_id"]);
  });

  await knex.schema.createTable("analytics_snapshots", (table) => {
    table.uuid("id").primary();
    table.uuid("portfolio_id").notNullable().references("portfolios.id").onDelete("CASCADE");
    table.date("as_of_date").notNullable();
    table.timestamp("generated_at").notNullable().defaultTo(knex.fn.now());
    table.string("base_currency", 3).notNullable().defaultTo("USD");
    table.enu("status", ["complete", "partial"]).notNullable();
    table.jsonb("metrics").notNullable();
    table.jsonb("positions").notNullable();
    table.jsonb("allocation").notNullable();
    table.jsonb("sector_exposure").notNullable();
    table.jsonb("performance").notNullable();
    table.jsonb("drawdown").notNullable();
    table.jsonb("correlation").notNullable();
    table.jsonb("insights").notNullable();
    table.jsonb("data_quality").notNullable();
    table.string("input_hash", 64).notNullable();
    table.integer("calculation_duration_ms").notNullable();
    table.unique(["portfolio_id", "as_of_date", "input_hash"]);
    table.index(["portfolio_id", "generated_at"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("analytics_snapshots");
  await knex.schema.dropTableIfExists("analytics_jobs");
}
