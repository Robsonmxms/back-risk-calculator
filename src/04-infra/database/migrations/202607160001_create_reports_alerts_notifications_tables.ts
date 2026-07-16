import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("reports", (table) => {
    table.uuid("id").primary();
    table.uuid("portfolio_id").notNullable().references("portfolios.id").onDelete("CASCADE");
    table.uuid("requested_by").notNullable().references("users.id").onDelete("CASCADE");
    table.string("format", 12).notNullable();
    table.string("status", 24).notNullable();
    table.string("file_key");
    table.string("content_type");
    table.string("failure_code");
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable();
    table.timestamp("completed_at", { useTz: true });
    table.index(["portfolio_id", "created_at"]);
    table.index(["status", "created_at"]);
  });

  await knex.schema.createTable("alerts", (table) => {
    table.uuid("id").primary();
    table.uuid("portfolio_id").notNullable().references("portfolios.id").onDelete("CASCADE");
    table.uuid("created_by").notNullable().references("users.id").onDelete("CASCADE");
    table.string("title", 160).notNullable();
    table.string("severity", 16).notNullable();
    table.string("status", 24).notNullable();
    table.jsonb("condition").notNullable();
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable();
    table.timestamp("last_triggered_at", { useTz: true });
    table.index(["portfolio_id", "status"]);
  });

  await knex.schema.createTable("notifications", (table) => {
    table.uuid("id").primary();
    table.uuid("portfolio_id").references("portfolios.id").onDelete("CASCADE");
    table.uuid("user_id").references("users.id").onDelete("CASCADE");
    table.string("title", 160).notNullable();
    table.text("body").notNullable();
    table.string("severity", 16).notNullable();
    table.string("status", 16).notNullable();
    table.string("source_type", 32).notNullable();
    table.uuid("source_id").notNullable();
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("read_at", { useTz: true });
    table.index(["user_id", "created_at"]);
    table.index(["portfolio_id", "created_at"]);
  });

  await knex.schema.createTable("realtime_events", (table) => {
    table.uuid("id").primary();
    table.string("type", 64).notNullable();
    table.uuid("portfolio_id").references("portfolios.id").onDelete("CASCADE");
    table.uuid("user_id").references("users.id").onDelete("CASCADE");
    table.jsonb("payload").notNullable();
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.index(["portfolio_id", "created_at"]);
    table.index(["user_id", "created_at"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("realtime_events");
  await knex.schema.dropTableIfExists("notifications");
  await knex.schema.dropTableIfExists("alerts");
  await knex.schema.dropTableIfExists("reports");
}
