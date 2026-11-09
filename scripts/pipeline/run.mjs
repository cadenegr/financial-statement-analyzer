// Runs the whole pipeline on one Smart View export, step by step. Each step
// reads the files the step before wrote, checks them, and writes its own.
//
// Run: node scripts/pipeline/run.mjs <export.xlsx>
// Output: .cache/pipeline/<file name>/  (report.md is the result to read)
// Needs: .venv with openpyxl (see 1-read.py) and the engine (make -C engine)

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error("usage: node scripts/pipeline/run.mjs <export.xlsx>");
  process.exit(1);
}
const dir = join(".cache/pipeline", basename(file, extname(file)));
const python = ".venv/bin/python";
if (!existsSync(python)) {
  console.error("step 1 needs openpyxl: python3 -m venv .venv && .venv/bin/pip install openpyxl");
  process.exit(1);
}
if (!existsSync("engine/map-engine")) {
  const make = spawnSync("make", ["-C", "engine"], { stdio: "inherit" });
  if (make.status !== 0) process.exit(make.status ?? 1);
}

const steps = [
  [python, "scripts/pipeline/1-read.py", file, dir],
  ["node", "scripts/pipeline/2-tree.mjs", dir],
  ["node", "scripts/pipeline/3-check.mjs", dir],
  ["node", "scripts/pipeline/4-engine.mjs", dir],
  ["node", "scripts/pipeline/5-report.mjs", dir],
];
for (const [cmd, ...args] of steps) {
  const { status } = spawnSync(cmd, args, { stdio: "inherit" });
  if (status !== 0) process.exit(status ?? 1);
}
