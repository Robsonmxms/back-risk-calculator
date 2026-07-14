import { scryptSync } from "crypto";
import { createKnexClient, getDatabaseUrl } from "./_database";

const now = new Date("2026-07-14T00:00:00.000Z");
const passwordSalt = "risk-calculator-dev-seed-salt";
const passwordHash = `${passwordSalt}:${scryptSync("Password123!", passwordSalt, 64).toString("hex")}`;

const users = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    email: "admin@risk.local",
    name: "Admin User",
    role: "admin",
    status: "active",
    password_hash: passwordHash,
    google_subject: null
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    email: "analyst@risk.local",
    name: "Analyst User",
    role: "analyst",
    status: "active",
    password_hash: passwordHash,
    google_subject: null
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    email: "user@risk.local",
    name: "Portfolio User",
    role: "user",
    status: "active",
    password_hash: passwordHash,
    google_subject: null
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    email: "other@risk.local",
    name: "Other User",
    role: "user",
    status: "active",
    password_hash: passwordHash,
    google_subject: null
  }
] as const;

const accounts = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "Main Portfolio Account",
    owner_user_id: "33333333-3333-4333-8333-333333333333"
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "Private Account",
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

      for (const account of accounts) {
        await trx("accounts")
          .insert({
            ...account,
            created_at: now,
            updated_at: now
          })
          .onConflict("id")
          .merge({
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
