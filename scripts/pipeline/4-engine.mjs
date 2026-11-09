// Step 4, engine: find the sign each account carries into its parent
// (+ added, - subtracted, ~ ignored), using only the numbers.
//
// Each parent is one puzzle for the engine (engine/map-engine):
//   cells       the children; value 0 = +, 1 = -, 2 = ~
//   groups      one per month column, over the children that are not 0 in
//               that month; its candidates are every sign pattern that makes
//               that month add up to the parent
// Months share children, so the engine cross-checks them, like rows and
// columns in Skyscrapers: only the patterns every month agrees on are left.
// Then the signs are compared with the catalog's operators.
//
// A month with more than 10 children that are not 0 has too many patterns
// (3^58 for the biggest parent). There the search assumes that most accounts
// add up and at most 2 are exceptions (- or ~): "few-exceptions" in the output.
//
// Run: node scripts/pipeline/4-engine.mjs <output folder>
// Reads 1-sheets.json, 2-tree.jsonl, 3-checks.jsonl (for the columns to use).
// Writes 4-maps/<parent>.map (the puzzles), 4-groups.jsonl (one line per
// parent), 4-signs.jsonl (one line per child). Needs: make -C engine

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fail, readJson, readJsonl, same, writeJsonl } from "./lib/jsonl.mjs";

const dir = process.argv[2];
const engine = process.env.ENGINE ?? "engine/map-engine";
if (!dir) fail(4, "usage: node scripts/pipeline/4-engine.mjs <output folder>");
if (!existsSync(engine)) fail(4, `no engine at ${engine}: run  make -C engine`);

const MAX_FREE = 10;        // most children one month may leave open: 3^10 = 59049 patterns
const MAX_SOLUTIONS = 20;
const MAX_EXCEPTIONS = 2;   // for bigger months: at most this many children not "+"
const SIGNS = ["+", "-", "~"];
const FACTOR = [1, -1, 0];

const sheets = readJson(4, dir, "1-sheets.json");
const tree = readJsonl(4, dir, "2-tree.jsonl");
const byId = new Map(tree.map((n) => [n.id, n]));
const mapsDir = join(dir, "4-maps");
mkdirSync(mapsDir, { recursive: true });

// The columns worth solving: the first of each name, not empty (as in step 3).
const useful = new Map();
for (const s of sheets) {
  const rows = tree.filter((n) => n.sheet === s.sheet);
  const first = new Map();
  s.columns.forEach((c, i) => first.has(c.name) || first.set(c.name, i));
  useful.set(s.sheet, s.columns.map((c, i) => i).filter((i) =>
    first.get(s.columns[i].name) === i && rows.some((r) => !same(r.values[i], 0))));
}

// Every sign pattern for k children that makes sum(sign * value) = target.
function patterns(values, target) {
  const k = values.length, out = [], cur = new Array(k);
  (function walk(i, sum) {
    if (i === k) {
      if (same(sum, target)) out.push([...cur]);
      return;
    }
    for (let v = 0; v < 3; v++) {
      cur[i] = v;
      walk(i + 1, sum + FACTOR[v] * values[i]);
    }
  })(0, 0);
  return out;
}

// The same, but only patterns with at most `budget` children that are not "+".
function fewExceptions(values, target, budget) {
  const k = values.length, out = [], cur = new Array(k).fill(0);
  const total = values.reduce((a, v) => a + v, 0);
  (function walk(from, left, sum) {
    if (same(sum, target)) out.push([...cur]);
    if (!left) return;
    for (let i = from; i < k; i++)
      for (const v of [1, 2]) {
        cur[i] = v;
        walk(i + 1, left - 1, sum - (1 - FACTOR[v]) * values[i]);
        cur[i] = 0;
      }
  })(0, budget, total);
  return out;
}

const groups = [], signs = [];
for (const p of tree.filter((n) => n.children.length)) {
  const kids = p.children.map((id) => byId.get(id));
  const cols = useful.get(p.sheet);
  const record = { id: p.id, sheet: p.sheet, label: p.label, member: p.member, children: kids.length, columns: 0 };
  const result = new Array(kids.length).fill(null);   // per child: set of values seen in solutions
  let how;

  if (kids.length > 64) {      // the engine's limit for one group
    how = "too-many-children";
  } else {
    const map = [`# ${p.id} ${p.label}: one cell per child (0 = +, 1 = -, 2 = ~), one group per month`,
      `cells ${kids.length}`];
    let open = 0, impossible = null, tooBig = null;   // tooBig: first month searched with few exceptions
    const inGroup = new Set();
    for (const c of cols) {
      const live = kids.map((k, j) => j).filter((j) => !same(kids[j].values[c], 0));
      if (!live.length && same(p.values[c], 0)) continue;   // nothing in this month
      const vals = live.map((j) => kids[j].values[c]);
      const big = live.length > MAX_FREE;
      if (big) tooBig ??= c;
      const cands = big ? fewExceptions(vals, p.values[c], MAX_EXCEPTIONS) : patterns(vals, p.values[c]);
      if (!cands.length) {
        impossible ??= c;
        continue;
      }
      record.columns++;
      open = Math.max(open, live.length);
      live.forEach((j) => inGroup.add(j));
      map.push(`group ${live.join(" ")}`, ...cands.map((x) => x.join(" ")), "end");
    }
    // A child that is 0 in every month is in no group: nothing can tell its sign.
    kids.forEach((_, j) => {
      if (!inGroup.has(j)) map.push(`domain ${j} 0`, `# child ${j} is 0 in every month: its sign is unknown`);
    });
    const file = join(mapsDir, `${p.id.replace(/[^\w]+/g, "_")}.map`);
    writeFileSync(file, map.join("\n") + "\n");
    record.map = file;
    record.mostOpen = open;

    if (impossible !== null) {
      how = "no-pattern";
      record.column = sheets.find((s) => s.sheet === p.sheet).columns[impossible].name;
    } else {
      const run = spawnSync(engine, [file, String(MAX_SOLUTIONS)], { encoding: "utf8" });
      if (run.status !== 0) fail(4, `engine failed on ${file}: ${run.stderr.trim()}`);
      const lines = run.stdout.trim().split("\n");
      const found = Number(lines[0].split(" ")[1]);
      record.solutions = found;
      record.guesses = Number(run.stderr.match(/(\d+) guesses/)?.[1] ?? 0);
      for (const line of lines.slice(1)) {
        line.split(" ").map(Number).forEach((v, j) => {
          if (inGroup.has(j)) (result[j] ??= new Set()).add(v);
        });
      }
      how = found === 0 ? "no-pattern" : found === 1 ? "solved" : "several";
      record.search = tooBig === null ? "every-pattern" : `few-exceptions (at most ${MAX_EXCEPTIONS} per month)`;
    }
  }
  record.how = how;
  groups.push(record);

  kids.forEach((k, j) => {
    const seen = result[j] ? [...result[j]] : [];
    const sign = seen.length === 1 ? SIGNS[seen[0]] : null;
    const catalog = k.agrees ? k.op : null;   // the catalog's operator, only if its parent is this parent
    signs.push({
      id: k.id, label: k.label, parent: p.id, parentLabel: p.label,
      sign, possible: seen.map((v) => SIGNS[v]).sort(),
      why: sign ? how : how === "solved" || how === "several" ? (seen.length ? "several" : "zero-everywhere") : how,
      catalog, agrees: sign && catalog ? sign === catalog : null,
    });
  });
}

writeJsonl(dir, "4-groups.jsonl", groups);
writeJsonl(dir, "4-signs.jsonl", signs);
const count = (list, f) => list.filter(f).length;
const hows = {};
for (const g of groups) hows[g.how] = (hows[g.how] ?? 0) + 1;
console.log(`step 4: ${groups.length} parents: ${Object.entries(hows).map(([k, v]) => `${k} ${v}`).join(", ")}`);
console.log(`step 4: ${signs.length} children: sign found ${count(signs, (s) => s.sign)} (+ ${count(signs, (s) => s.sign === "+")}, - ${count(signs, (s) => s.sign === "-")}, ~ ${count(signs, (s) => s.sign === "~")}), unknown ${count(signs, (s) => !s.sign)}`);
console.log(`step 4: against the catalog: agree ${count(signs, (s) => s.agrees === true)}, disagree ${count(signs, (s) => s.agrees === false)}`);
