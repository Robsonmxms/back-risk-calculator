import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: ["dist/**", "scripts/**", "tests/**", "src/app.ts", "src/04-infra/server.ts"],
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 55,
        functions: 80,
        lines: 80,
        statements: 80
      }
    },
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"]
  }
});
