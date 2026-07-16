import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("portfolios", (table) => {
    table.uuid("id").primary();
    table.uuid("office_id").notNullable().references("offices.id").onDelete("CASCADE");
    table.uuid("account_id").notNullable().references("accounts.id").onDelete("CASCADE");
    table.string("name").notNullable();
    table.text("description");
    table.string("base_currency", 3).notNullable();
    table.timestamps(true, true);
    table.index(["office_id", "updated_at"]);
    table.index(["account_id", "updated_at"]);
  });

  await knex.schema.createTable("transactions", (table) => {
    table.uuid("id").primary();
    table.uuid("portfolio_id").notNullable().references("portfolios.id").onDelete("CASCADE");
    table.string("asset_symbol", 24).notNullable();
    table.string("asset_name").notNullable();
    table.date("trade_date").notNullable();
    table.enu("type", ["buy", "sell"]).notNullable();
    table.decimal("quantity", 24, 8).notNullable();
    table.decimal("unit_price", 24, 8).notNullable();
    table.decimal("total_amount", 24, 8).notNullable();
    table.string("currency", 3).notNullable();
    table.text("notes");
    table.string("idempotency_key");
    table.text("idempotency_fingerprint");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.index(["portfolio_id", "trade_date"]);
    table.index(["portfolio_id", "asset_symbol"]);
    table.unique(["portfolio_id", "idempotency_key"]);
  });

  await knex.schema.createTable("positions", (table) => {
    table.uuid("portfolio_id").notNullable().references("portfolios.id").onDelete("CASCADE");
    table.string("asset_symbol", 24).notNullable();
    table.string("asset_name").notNullable();
    table.decimal("quantity", 24, 8).notNullable();
    table.decimal("average_cost", 24, 8).notNullable();
    table.decimal("total_cost_basis", 24, 8).notNullable();
    table.string("currency", 3).notNullable();
    table.date("last_transaction_date").notNullable();
    table.primary(["portfolio_id", "asset_symbol"]);
  });

  await knex.schema.createTable("portfolio_snapshots", (table) => {
    table.uuid("id").primary();
    table.uuid("portfolio_id").notNullable().references("portfolios.id").onDelete("CASCADE");
    table.date("as_of_date").notNullable();
    table.jsonb("positions").notNullable();
    table.integer("transaction_count").notNullable();
    table.decimal("total_cost_basis", 24, 8).notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.index(["portfolio_id", "as_of_date"]);
  });

  await knex.schema.createTable("outbox_events", (table) => {
    table.uuid("id").primary();
    table.string("topic").notNullable();
    table.string("aggregate_id").notNullable();
    table.jsonb("payload").notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.index(["topic", "created_at"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("outbox_events");
  await knex.schema.dropTableIfExists("portfolio_snapshots");
  await knex.schema.dropTableIfExists("positions");
  await knex.schema.dropTableIfExists("transactions");
  await knex.schema.dropTableIfExists("portfolios");
}
