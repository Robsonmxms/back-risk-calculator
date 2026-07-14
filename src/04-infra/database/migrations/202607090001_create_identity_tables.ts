import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("users", (table) => {
    table.uuid("id").primary();
    table.string("email").notNullable().unique();
    table.string("name").notNullable();
    table.enu("role", ["admin", "analyst", "user"]).notNullable();
    table.enu("status", ["active", "disabled"]).notNullable().defaultTo("active");
    table.text("password_hash");
    table.string("google_subject").unique();
    table.timestamps(true, true);
  });

  await knex.schema.createTable("accounts", (table) => {
    table.uuid("id").primary();
    table.string("name").notNullable();
    table.uuid("owner_user_id").notNullable().references("users.id");
    table.timestamps(true, true);
  });

  await knex.schema.createTable("account_members", (table) => {
    table.uuid("id").primary();
    table.uuid("account_id").notNullable().references("accounts.id").onDelete("CASCADE");
    table.uuid("user_id").notNullable().references("users.id").onDelete("CASCADE");
    table.enu("role", ["owner", "analyst", "viewer"]).notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.unique(["account_id", "user_id"]);
  });

  await knex.schema.createTable("refresh_tokens", (table) => {
    table.uuid("id").primary();
    table.uuid("user_id").notNullable().references("users.id").onDelete("CASCADE");
    table.string("token_hash", 64).notNullable().unique();
    table.uuid("family_id").notNullable().index();
    table.uuid("replaced_by_token_id");
    table.timestamp("expires_at").notNullable();
    table.timestamp("revoked_at");
    table.string("revocation_reason");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("oauth_accounts", (table) => {
    table.uuid("id").primary();
    table.uuid("user_id").notNullable().references("users.id").onDelete("CASCADE");
    table.string("provider").notNullable();
    table.string("provider_subject").notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.unique(["provider", "provider_subject"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("oauth_accounts");
  await knex.schema.dropTableIfExists("refresh_tokens");
  await knex.schema.dropTableIfExists("account_members");
  await knex.schema.dropTableIfExists("accounts");
  await knex.schema.dropTableIfExists("users");
}
