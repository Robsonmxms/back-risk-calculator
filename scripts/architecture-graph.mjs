import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

export function collectSourceFiles(rootDirectory) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(absolutePath);
    }
  };
  visit(rootDirectory);
  return files.sort();
}

export function collectModuleSpecifiers(sourceText, fileName = "source.ts") {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  const specifiers = [];
  const addLiteral = (node) => {
    if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addLiteral(node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      addLiteral(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

export function findCycles(graph) {
  const cycles = [];
  const state = new Map();
  const stack = [];
  const visit = (file) => {
    state.set(file, "visiting");
    stack.push(file);
    for (const dependency of graph.get(file) ?? []) {
      if (!graph.has(dependency)) continue;
      if (state.get(dependency) === "visiting") {
        const start = stack.indexOf(dependency);
        cycles.push([...stack.slice(start), dependency]);
      } else if (!state.has(dependency)) {
        visit(dependency);
      }
    }
    stack.pop();
    state.set(file, "visited");
  };
  for (const file of graph.keys()) if (!state.has(file)) visit(file);
  return cycles;
}

export function resolveProductionGraph(files, compilerOptions, projectRoot) {
  const canonicalFiles = new Set(files.map((file) => path.resolve(file)));
  const graph = new Map();
  const unresolvedLegacyImports = [];
  for (const file of canonicalFiles) {
    const sourceText = fs.readFileSync(file, "utf8");
    const dependencies = [];
    for (const specifier of collectModuleSpecifiers(sourceText, file)) {
      if (specifier.includes("/modules/") || specifier.startsWith("modules/")) {
        unresolvedLegacyImports.push({ importer: file, specifier });
      }
      const resolved = ts.resolveModuleName(specifier, file, compilerOptions, ts.sys).resolvedModule;
      if (!resolved) continue;
      const target = path.resolve(resolved.resolvedFileName);
      if (canonicalFiles.has(target)) dependencies.push(target);
    }
    graph.set(file, [...new Set(dependencies)]);
  }
  return { graph, unresolvedLegacyImports, projectRoot: path.resolve(projectRoot) };
}

export function relativePath(projectRoot, file) {
  return path.relative(projectRoot, file).split(path.sep).join("/");
}
