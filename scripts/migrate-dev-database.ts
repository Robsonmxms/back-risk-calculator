import { createKnexClient, getDatabaseUrl } from "./_database";

async function main() {
  const db = createKnexClient();

  try {
    const [batch, migrations] = await db.migrate.latest();
    process.stdout.write(
      JSON.stringify({
        level: "info",
        message: "db.migrate.completed",
        databaseUrl: getDatabaseUrl(),
        batch,
        migrations
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
