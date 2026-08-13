import { scryptSync } from "crypto";
import { createKnexClient, getDatabaseUrl } from "./_database";

const now = new Date("2026-07-14T00:00:00.000Z");
const passwordSalt = "risk-calculator-dev-seed-salt";
const passwordHash = `${passwordSalt}:${scryptSync("Password123!", passwordSalt, 64).toString("hex")}`;

const users = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    email: "admin@risk.local",
    name: "Administrador",
    role: "admin",
    status: "active",
    password_hash: passwordHash,
    google_subject: null
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    email: "analyst@risk.local",
    name: "Analista",
    role: "analyst",
    status: "active",
    password_hash: passwordHash,
    google_subject: null
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    email: "user@risk.local",
    name: "Usuário do Portfólio",
    role: "user",
    status: "active",
    password_hash: passwordHash,
    google_subject: null
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    email: "other@risk.local",
    name: "Usuário Secundário",
    role: "user",
    status: "active",
    password_hash: passwordHash,
    google_subject: null
  }
] as const;

const office = {
  id: "55555555-5555-4555-8555-555555555555",
  name: "Risk Calculator Dev Office",
  status: "active"
} as const;

const officeMembers = [
  {
    id: "55555555-1111-4111-8111-555555551111",
    office_id: office.id,
    user_id: "11111111-1111-4111-8111-111111111111",
    role: "office_admin"
  },
  {
    id: "55555555-2222-4222-8222-555555552222",
    office_id: office.id,
    user_id: "22222222-2222-4222-8222-222222222222",
    role: "analyst"
  },
  {
    id: "55555555-3333-4333-8333-555555553333",
    office_id: office.id,
    user_id: "33333333-3333-4333-8333-333333333333",
    role: "client"
  },
  {
    id: "55555555-4444-4444-8444-555555554444",
    office_id: office.id,
    user_id: "44444444-4444-4444-8444-444444444444",
    role: "client"
  }
] as const;

const accounts = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    office_id: office.id,
    name: "Conta Principal de Portfólio",
    owner_user_id: "33333333-3333-4333-8333-333333333333"
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    office_id: office.id,
    name: "Conta Reservada",
    owner_user_id: "44444444-4444-4444-8444-444444444444"
  }
] as const;

const members = [
  {
    id: "aaaaaaaa-1111-4111-8111-aaaaaaaa1111",
    account_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    user_id: "33333333-3333-4333-8333-333333333333",
    role: "owner"
  },
  {
    id: "aaaaaaaa-2222-4222-8222-aaaaaaaa2222",
    account_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    user_id: "22222222-2222-4222-8222-222222222222",
    role: "analyst"
  },
  {
    id: "bbbbbbbb-4444-4444-8444-bbbbbbbb4444",
    account_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    user_id: "44444444-4444-4444-8444-444444444444",
    role: "owner"
  }
] as const;

async function main() {
  const db = createKnexClient();

  try {
    await db.transaction(async (trx) => {
      for (const user of users) {
        await trx("users")
          .insert({
            ...user,
            created_at: now,
            updated_at: now
          })
          .onConflict("id")
          .merge({
            email: user.email,
            name: user.name,
            role: user.role,
            status: user.status,
            password_hash: user.password_hash,
            google_subject: user.google_subject,
            updated_at: now
          });
      }

      await trx("offices")
        .insert({
          ...office,
          created_at: now,
          updated_at: now
        })
        .onConflict("id")
        .merge({
          name: office.name,
          status: office.status,
          updated_at: now
        });

      for (const officeMember of officeMembers) {
        await trx("office_members")
          .insert({
            ...officeMember,
            created_at: now
          })
          .onConflict(["office_id", "user_id"])
          .merge({
            role: officeMember.role
          });
      }

      for (const account of accounts) {
        await trx("accounts")
          .insert({
            ...account,
            created_at: now,
            updated_at: now
          })
          .onConflict("id")
          .merge({
            office_id: account.office_id,
            name: account.name,
            owner_user_id: account.owner_user_id,
            updated_at: now
          });
      }

      for (const member of members) {
        await trx("account_members")
          .insert({
            ...member,
            created_at: now
          })
          .onConflict(["account_id", "user_id"])
          .merge({
            role: member.role
          });
      }
    });

    process.stdout.write(
      JSON.stringify({
        level: "info",
        message: "db.seed.completed",
        databaseUrl: getDatabaseUrl(),
        users: users.map((user) => user.email),
        accounts: accounts.map((account) => account.name)
      }) + "\n"
    );
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
