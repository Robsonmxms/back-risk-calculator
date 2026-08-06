/* global console, process */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  collectSourceFiles,
  findCycles,
  relativePath,
  resolveProductionGraph
} from "./architecture-graph.mjs";

const projectRoot = process.cwd();
const sourceRoot = path.join(projectRoot, "src");
const allowedSourceRoots = new Set([
  "01-domain",
  "02-application",
  "03-adapters",
  "04-infra",
  "app.ts"
]);
const layerRank = new Map([
  ["app.ts", 0],
  ["04-infra", 1],
  ["03-adapters", 2],
  ["02-application", 3],
  ["01-domain", 4]
]);
const failures = [];

for (const entry of fs.readdirSync(sourceRoot)) {
  if (!allowedSourceRoots.has(entry)) {
    failures.push(`src/${entry} violates the backend source-root allowlist`);
  }
}

const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, "tsconfig.json");
const config = ts.parseJsonConfigFileContent(
  ts.readConfigFile(configPath, ts.sys.readFile).config,
  ts.sys,
  projectRoot
);
const files = collectSourceFiles(sourceRoot);
const { graph, unresolvedLegacyImports } = resolveProductionGraph(
  files,
  config.options,
  projectRoot
);

for (const legacyImport of unresolvedLegacyImports) {
  failures.push(
    `${relativePath(projectRoot, legacyImport.importer)} -> ${legacyImport.specifier}: legacy src/modules imports are forbidden`
  );
}

for (const [importer, dependencies] of graph) {
  const importerRelative = relativePath(sourceRoot, importer);
  const importerRoot = importerRelative.split("/")[0];
  const importerRank = layerRank.get(importerRoot);
  for (const imported of dependencies) {
    const importedRelative = relativePath(sourceRoot, imported);
    const importedRoot = importedRelative.split("/")[0];
    const importedRank = layerRank.get(importedRoot);
    if (importerRank === undefined || importedRank === undefined) continue;
    if (importedRank < importerRank) {
      failures.push(
        `${relativePath(projectRoot, importer)} -> ${relativePath(projectRoot, imported)}: ${importerRoot} may import only itself and inward layers (expected rank >= ${importerRank})`
      );
    }
  }
}

for (const cycle of findCycles(graph)) {
  failures.push(`production cycle: ${cycle.map((file) => relativePath(projectRoot, file)).join(" -> ")}`);
}

if (failures.length > 0) {
  console.error(`Backend architecture check failed (${failures.length} violation(s)):\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Backend architecture check passed for ${files.length} production source files.`);
}
