import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("audit_events", (table) => {
    table.uuid("id").primary();
    table.uuid("office_id").notNullable().references("offices.id").onDelete("CASCADE");
    table.uuid("actor_id").references("users.id").onDelete("SET NULL");
    table.string("actor_name", 160);
    table.string("action", 120).notNullable();
    table.string("resource_type", 32).notNullable();
    table.string("resource_id").notNullable();
    table.uuid("client_id").references("clients.id").onDelete("SET NULL");
    table.uuid("portfolio_id");
    table.string("outcome", 16).notNullable();
    table.string("severity", 16).notNullable();
    table.boolean("review_required").notNullable().defaultTo(false);
    table.jsonb("metadata").notNullable().defaultTo("{}");
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.index(["office_id", "created_at"]);
    table.index(["office_id", "actor_id"]);
    table.index(["office_id", "action"]);
    table.index(["office_id", "resource_type", "resource_id"]);
    table.index(["office_id", "client_id"]);
    table.index(["office_id", "portfolio_id"]);
  });

  await knex.schema.createTable("supervision_reviews", (table) => {
    table.uuid("id").primary();
    table.uuid("office_id").notNullable().references("offices.id").onDelete("CASCADE");
    table.uuid("audit_event_id").notNullable().references("audit_events.id").onDelete("CASCADE");
    table.string("status", 24).notNullable();
    table.string("severity", 16).notNullable();
    table.uuid("assigned_to_user_id").references("users.id").onDelete("SET NULL");
    table.text("resolution_comment");
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable();
    table.timestamp("resolved_at", { useTz: true });
    table.index(["office_id", "status"]);
    table.index(["office_id", "severity"]);
    table.index(["office_id", "assigned_to_user_id"]);
  });

  await knex.schema.createTable("audit_exports", (table) => {
    table.uuid("id").primary();
    table.uuid("office_id").notNullable().references("offices.id").onDelete("CASCADE");
    table.uuid("requested_by").notNullable().references("users.id").onDelete("CASCADE");
    table.string("format", 12).notNullable();
    table.string("status", 24).notNullable();
    table.integer("event_count").notNullable();
    table.jsonb("filters").notNullable().defaultTo("{}");
    table.string("download_url").notNullable();
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("completed_at", { useTz: true });
    table.index(["office_id", "created_at"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("audit_exports");
  await knex.schema.dropTableIfExists("supervision_reviews");
  await knex.schema.dropTableIfExists("audit_events");
}
