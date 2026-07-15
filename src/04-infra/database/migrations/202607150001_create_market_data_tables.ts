import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("market_assets", (table) => {
    table.string("id", 64).primary();
    table.string("symbol", 24).notNullable().unique();
    table.string("provider_symbol", 64).notNullable();
    table.string("name").notNullable();
    table.string("exchange", 32);
    table.string("currency", 3).notNullable();
    table.enu("asset_type", ["stock", "etf", "fund", "crypto"]).notNullable();
    table.string("region", 16);
    table.string("sector");
    table.string("provider_name").notNullable();
    table.boolean("is_active").notNullable().defaultTo(true);
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    table.index(["provider_name", "provider_symbol"]);
  });

  await knex.schema.createTable("latest_quotes", (table) => {
    table.string("asset_id", 64).primary().references("market_assets.id").onDelete("CASCADE");
    table.string("symbol", 24).notNullable();
    table.string("provider_name").notNullable();
    table.string("currency", 3).notNullable();
    table.decimal("price", 24, 8).notNullable();
    table.timestamp("as_of").notNullable();
    table.enu("freshness", ["fresh", "partial", "stale"]).notNullable();
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    table.index(["symbol", "updated_at"]);
  });

  await knex.schema.createTable("historical_prices", (table) => {
    table.string("asset_id", 64).notNullable().references("market_assets.id").onDelete("CASCADE");
    table.string("symbol", 24).notNullable();
    table.string("provider_name").notNullable();
    table.date("date").notNullable();
    table.decimal("open", 24, 8).notNullable();
    table.decimal("high", 24, 8).notNullable();
    table.decimal("low", 24, 8).notNullable();
    table.decimal("close", 24, 8).notNullable();
    table.decimal("adjusted_close", 24, 8).notNullable();
    table.bigInteger("volume").notNullable();
    table.string("currency", 3).notNullable();
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    table.primary(["asset_id", "date"]);
    table.index(["symbol", "date"]);
  });

  await knex.schema.createTable("dividends", (table) => {
    table.string("asset_id", 64).notNullable().references("market_assets.id").onDelete("CASCADE");
    table.string("symbol", 24).notNullable();
    table.string("provider_name").notNullable();
    table.date("ex_date").notNullable();
    table.date("payment_date");
    table.decimal("amount", 24, 8).notNullable();
    table.string("currency", 3).notNullable();
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    table.primary(["asset_id", "ex_date"]);
  });

  await knex.schema.createTable("splits", (table) => {
    table.string("asset_id", 64).notNullable().references("market_assets.id").onDelete("CASCADE");
    table.string("symbol", 24).notNullable();
    table.string("provider_name").notNullable();
    table.date("date").notNullable();
    table.decimal("ratio", 18, 8).notNullable();
    table.integer("numerator").notNullable();
    table.integer("denominator").notNullable();
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    table.primary(["asset_id", "date"]);
  });

  await knex.schema.createTable("provider_requests", (table) => {
    table.uuid("id").primary();
    table.string("provider_name").notNullable();
    table.string("operation").notNullable();
    table.string("symbol", 24);
    table.enu("status", ["succeeded", "failed"]).notNullable();
    table.integer("latency_ms").notNullable();
    table.string("correlation_id").notNullable();
    table.string("error_code");
    table.text("message");
    table.timestamp("requested_at").notNullable().defaultTo(knex.fn.now());
    table.index(["provider_name", "requested_at"]);
    table.index(["correlation_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("provider_requests");
  await knex.schema.dropTableIfExists("splits");
  await knex.schema.dropTableIfExists("dividends");
  await knex.schema.dropTableIfExists("historical_prices");
  await knex.schema.dropTableIfExists("latest_quotes");
  await knex.schema.dropTableIfExists("market_assets");
}
