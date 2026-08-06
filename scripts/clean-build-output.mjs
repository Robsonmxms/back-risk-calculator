/* global process */

import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(process.cwd());
const buildOutput = path.join(projectRoot, "dist");
if (path.dirname(buildOutput) !== projectRoot || path.basename(buildOutput) !== "dist") {
  throw new Error("Refusing to clean an unexpected build output path");
}
fs.rmSync(buildOutput, { recursive: true, force: true });
