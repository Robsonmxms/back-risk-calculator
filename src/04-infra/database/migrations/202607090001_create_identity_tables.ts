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

  await knex.schema.createTable("offices", (table) => {
    table.uuid("id").primary();
    table.string("name").notNullable();
    table.enu("status", ["active", "disabled"]).notNullable().defaultTo("active");
    table.timestamps(true, true);
  });

  await knex.schema.createTable("office_members", (table) => {
    table.uuid("id").primary();
    table.uuid("office_id").notNullable().references("offices.id").onDelete("CASCADE");
    table.uuid("user_id").notNullable().references("users.id").onDelete("CASCADE");
    table
      .enu("role", ["office_admin", "advisor", "analyst", "assistant", "client"])
      .notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.unique(["office_id", "user_id"]);
  });

  await knex.schema.createTable("advisory_teams", (table) => {
    table.uuid("id").primary();
    table.uuid("office_id").notNullable().references("offices.id").onDelete("CASCADE");
    table.string("name").notNullable();
    table.text("description");
    table.enu("status", ["active", "archived"]).notNullable().defaultTo("active");
    table.timestamps(true, true);
    table.index(["office_id", "status"]);
  });

  await knex.schema.createTable("advisory_team_members", (table) => {
    table.uuid("id").primary();
    table.uuid("office_id").notNullable().references("offices.id").onDelete("CASCADE");
    table.uuid("team_id").notNullable().references("advisory_teams.id").onDelete("CASCADE");
    table.uuid("user_id").notNullable().references("users.id").onDelete("CASCADE");
    table
      .enu("role", ["office_admin", "advisor", "analyst", "assistant", "client"])
      .notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.unique(["team_id", "user_id"]);
    table.index(["office_id", "user_id"]);
  });

  await knex.schema.createTable("advisory_assignments", (table) => {
    table.uuid("id").primary();
    table.uuid("office_id").notNullable().references("offices.id").onDelete("CASCADE");
    table.enu("resource_type", ["client", "household", "account", "portfolio"]).notNullable();
    table.string("resource_id").notNullable();
    table.uuid("assignee_user_id").references("users.id").onDelete("CASCADE");
    table.uuid("team_id").references("advisory_teams.id").onDelete("CASCADE");
    table.specificType("permissions", "text[]").notNullable();
    table.uuid("created_by").notNullable().references("users.id");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("revoked_at");
    table.index(["office_id", "resource_type", "resource_id"]);
    table.index(["office_id", "assignee_user_id"]);
    table.index(["office_id", "team_id"]);
  });

  await knex.schema.createTable("households", (table) => {
    table.uuid("id").primary();
    table.uuid("office_id").notNullable().references("offices.id").onDelete("CASCADE");
    table.string("name").notNullable();
    table.enu("status", ["active", "archived"]).notNullable().defaultTo("active");
    table.timestamps(true, true);
    table.index(["office_id", "status"]);
  });

  await knex.schema.createTable("clients", (table) => {
    table.uuid("id").primary();
    table.uuid("office_id").notNullable().references("offices.id").onDelete("CASCADE");
    table.uuid("household_id").references("households.id").onDelete("SET NULL");
    table.string("name").notNullable();
    table.string("email").notNullable();
    table.string("phone");
    table.string("document_label");
    table.enu("status", ["active", "inactive", "archived"]).notNullable().defaultTo("active");
    table
      .enu("onboarding_status", ["invited", "onboarding", "complete", "paused"])
      .notNullable()
      .defaultTo("onboarding");
    table.uuid("advisor_user_id").references("users.id").onDelete("SET NULL");
    table.string("risk_profile_descriptor").notNullable();
    table.text("notes");
    table.timestamp("archived_at");
    table.timestamps(true, true);
    table.index(["office_id", "status"]);
    table.index(["office_id", "advisor_user_id"]);
    table.index(["office_id", "household_id"]);
    table.index(["office_id", "onboarding_status"]);
  });

  await knex.schema.createTable("accounts", (table) => {
    table.uuid("id").primary();
    table.uuid("office_id").notNullable().references("offices.id").onDelete("CASCADE");
    table.uuid("client_id").references("clients.id").onDelete("SET NULL");
    table.uuid("household_id").references("households.id").onDelete("SET NULL");
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
  await knex.schema.dropTableIfExists("clients");
  await knex.schema.dropTableIfExists("households");
  await knex.schema.dropTableIfExists("advisory_assignments");
  await knex.schema.dropTableIfExists("advisory_team_members");
  await knex.schema.dropTableIfExists("advisory_teams");
  await knex.schema.dropTableIfExists("office_members");
  await knex.schema.dropTableIfExists("offices");
  await knex.schema.dropTableIfExists("users");
}
