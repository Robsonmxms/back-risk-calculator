export function collectSourceFiles(rootDirectory: string): string[];
export function collectModuleSpecifiers(sourceText: string, fileName?: string): string[];
export function findCycles(graph: Map<string, string[]>): string[][];
export function resolveProductionGraph(
  files: string[],
  compilerOptions: object,
  projectRoot: string
): {
  graph: Map<string, string[]>;
  unresolvedLegacyImports: Array<{ importer: string; specifier: string }>;
  projectRoot: string;
};
export function relativePath(projectRoot: string, file: string): string;
