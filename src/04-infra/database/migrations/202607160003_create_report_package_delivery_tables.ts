import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("report_packages", (table) => {
    table.uuid("id").primary();
    table.uuid("office_id").notNullable().references("offices.id").onDelete("CASCADE");
    table.uuid("client_id").notNullable().references("clients.id").onDelete("CASCADE");
    table.uuid("household_id").references("households.id").onDelete("SET NULL");
    table.string("title", 180).notNullable();
    table.text("summary_notes").notNullable();
    table.text("internal_notes");
    table.string("status", 32).notNullable();
    table.uuid("created_by").notNullable().references("users.id");
    table.uuid("approved_by").references("users.id");
    table.uuid("delivered_by").references("users.id");
    table.uuid("viewed_by").references("users.id");
    table.uuid("revoked_by").references("users.id");
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable();
    table.timestamp("approved_at", { useTz: true });
    table.timestamp("delivered_at", { useTz: true });
    table.timestamp("viewed_at", { useTz: true });
    table.timestamp("revoked_at", { useTz: true });
    table.index(["office_id", "client_id"]);
    table.index(["office_id", "status"]);
  });

  await knex.schema.createTable("report_package_items", (table) => {
    table.uuid("id").primary();
    table.uuid("package_id").notNullable().references("report_packages.id").onDelete("CASCADE");
    table.string("type", 32).notNullable();
    table.string("title", 180).notNullable();
    table.uuid("portfolio_id");
    table.uuid("report_id");
    table.string("analytics_snapshot_id");
    table.string("format", 12);
    table.string("status", 24).notNullable();
    table.index(["package_id"]);
    table.index(["portfolio_id"]);
    table.index(["report_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("report_package_items");
  await knex.schema.dropTableIfExists("report_packages");
}
