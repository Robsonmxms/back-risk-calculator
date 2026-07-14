import { createApp } from "../app";
import { loadConfig } from "./config/env";

async function main() {
  const config = loadConfig();
  const { app } = await createApp();

  app.listen(config.port, () => {
    process.stdout.write(
      JSON.stringify({
        level: "info",
        message: "api.started",
        port: config.port
      }) + "\n"
    );
  });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
