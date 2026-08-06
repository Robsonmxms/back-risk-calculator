import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("transactions", (table) => {
    table.string("source", 32).notNullable().defaultTo("manual");
    table.uuid("import_id");
    table.integer("source_row_number");
  });

  await knex.schema.createTable("portfolio_import_jobs", (table) => {
    table.uuid("id").primary();
    table.string("type", 64).notNullable();
    table.uuid("office_id").notNullable().references("offices.id").onDelete("CASCADE");
    table.uuid("account_id").notNullable().references("accounts.id").onDelete("CASCADE");
    table.uuid("requested_by").notNullable().references("users.id").onDelete("CASCADE");
    table.uuid("correlation_id").notNullable();
    table.string("idempotency_key", 160).notNullable();
    table.string("request_fingerprint", 64).notNullable();
    table.string("source_sha256", 64).notNullable();
    table.string("original_file_name", 180).notNullable();
    table.string("media_type", 160).notNullable();
    table.bigInteger("byte_size").notNullable();
    table.text("source_key").notNullable();
    table.integer("template_version");
    table.string("status", 24).notNullable();
    table.string("phase", 40).notNullable();
    table.integer("attempts").notNullable().defaultTo(0);
    table.jsonb("progress").notNullable();
    table.jsonb("failure");
    table.text("error_report_key");
    table.uuid("portfolio_id").references("portfolios.id").onDelete("SET NULL");
    table.string("lease_owner", 160);
    table.timestamp("lease_expires_at", { useTz: true });
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable();
    table.timestamp("started_at", { useTz: true });
    table.timestamp("completed_at", { useTz: true });
    table.timestamp("source_expires_at", { useTz: true });
    table.timestamp("error_report_expires_at", { useTz: true });
    table.unique(["requested_by", "account_id", "idempotency_key"]);
    table.index(["account_id", "created_at"]);
    table.index(["status", "created_at"]);
    table.index(["lease_expires_at"]);
  });

  await knex.schema.createTable("portfolio_import_rows", (table) => {
    table
      .uuid("import_id")
      .notNullable()
      .references("portfolio_import_jobs.id")
      .onDelete("CASCADE");
    table.integer("row_number").notNullable();
    table.string("external_id", 180);
    table.jsonb("normalized_payload").notNullable();
    table.string("status", 24).notNullable();
    table.jsonb("errors").notNullable().defaultTo("[]");
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(["import_id", "row_number"]);
    table.index(["import_id", "status"]);
  });

  await knex.schema.createTable("portfolio_import_outbox", (table) => {
    table.uuid("id").primary();
    table
      .uuid("import_id")
      .notNullable()
      .references("portfolio_import_jobs.id")
      .onDelete("CASCADE");
    table.string("topic", 80).notNullable();
    table.jsonb("payload").notNullable();
    table.integer("attempts").notNullable().defaultTo(0);
    table.timestamp("available_at", { useTz: true }).notNullable();
    table.timestamp("published_at", { useTz: true });
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.index(["published_at", "available_at"]);
  });

  await knex.schema.alterTable("transactions", (table) => {
    table.foreign("import_id").references("portfolio_import_jobs.id").onDelete("SET NULL");
    table.index(["import_id", "source_row_number"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("transactions", (table) => {
    table.dropIndex(["import_id", "source_row_number"]);
    table.dropForeign("import_id");
  });
  await knex.schema.dropTableIfExists("portfolio_import_outbox");
  await knex.schema.dropTableIfExists("portfolio_import_rows");
  await knex.schema.dropTableIfExists("portfolio_import_jobs");
  await knex.schema.alterTable("transactions", (table) => {
    table.dropColumn("source_row_number");
    table.dropColumn("import_id");
    table.dropColumn("source");
  });
}
