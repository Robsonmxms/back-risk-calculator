import { describe, expect, it } from "vitest";
import { collectModuleSpecifiers, findCycles } from "../../scripts/architecture-graph.mjs";

describe("architecture graph", () => {
  it("collects static, type-only, export, dynamic and CommonJS dependencies", () => {
    const source = `
      import value from "./static";
      import type { Contract } from "./type-only";
      export { item } from "./barrel";
      export type { Shape } from "./type-export";
      const lazy = import("./dynamic");
      const legacy = require("./commonjs");
    `;

    expect(collectModuleSpecifiers(source)).toEqual([
      "./static",
      "./type-only",
      "./barrel",
      "./type-export",
      "./dynamic",
      "./commonjs"
    ]);
  });

  it("detects production dependency cycles", () => {
    const graph = new Map([
      ["domain.ts", ["application.ts"]],
      ["application.ts", ["adapter.ts"]],
      ["adapter.ts", ["domain.ts"]]
    ]);

    expect(findCycles(graph)).toEqual([["domain.ts", "application.ts", "adapter.ts", "domain.ts"]]);
  });
});
