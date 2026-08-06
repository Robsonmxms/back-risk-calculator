/* global console, process */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();

const bootPaths = [
  "src/app.ts",
  "src/04-infra/main.ts",
  "src/04-infra/server.ts",
  "src/04-infra/container"
];

const prohibitedBusinessLiterals = [
  "Orion Advisory",
  "Família Silva",
  "Marina Silva",
  "Renato Silva",
  "Cliente Reservado",
  "Carteira Crescimento",
  "Alice Founder",
  "Alice Fundadora",
  "Risk Calculator Dev Office",
  "Conta Principal de Portfólio",
  "Conta Reservada"
];

const prohibitedFixtureIdentities = [
  "admin@example.com",
  "analyst@example.com",
  "user@example.com",
  "other@example.com",
  "admin@risk.local",
  "analyst@risk.local",
  "user@risk.local",
  "other@risk.local"
];
const fixedCalendarDatePattern = /["'`]20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])["'`]/g;

const failures = [];

for (const file of listFiles(join(root, "src"))) {
  const relativePath = normalize(relative(root, file));
  const content = readFileSync(file, "utf8");

  if (isBootPath(relativePath) && content.includes("createSeededIdentityStore")) {
    failures.push(`${relativePath}: imports or calls createSeededIdentityStore from runtime boot`);
  }

  for (const literal of prohibitedBusinessLiterals) {
    if (content.includes(literal)) {
      failures.push(`${relativePath}: contains prohibited runtime business literal "${literal}"`);
    }
  }

  for (const identity of prohibitedFixtureIdentities) {
    if (content.includes(identity)) {
      failures.push(`${relativePath}: contains prohibited fixture identity "${identity}"`);
    }
  }

  for (const match of content.matchAll(fixedCalendarDatePattern)) {
    failures.push(`${relativePath}: contains fixed runtime calendar date ${match[0]}`);
  }
}

if (failures.length > 0) {
  console.error("Runtime mock data check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Runtime mock data check passed.");

function isBootPath(relativePath) {
  return bootPaths.some((bootPath) => relativePath === bootPath || relativePath.startsWith(`${bootPath}/`));
}

function listFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      return listFiles(path);
    }

    return stat.isFile() && /\.(ts|tsx|js|mjs)$/.test(entry) ? [path] : [];
  });
}

function normalize(path) {
  return path.replaceAll("\\", "/");
}
