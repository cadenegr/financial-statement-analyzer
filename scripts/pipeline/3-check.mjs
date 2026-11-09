// Step 3, check: the rules a financial statement must follow, like "every
// move is legal" for a chess game. Signs are left to step 4; this step checks
// everything that needs no guessing.
//
// Run: node scripts/pipeline/3-check.mjs <output folder>
// Reads 1-sheets.json, 2-tree.jsonl. Writes 3-checks.jsonl, one line per
// check that failed: { check, sheet, id?, label?, column?, expected, got, diff }
//
// Checks:
//   plain-sum         parent = sum of its children (fails where a child is
//                     subtracted: step 4 finds those signs)
//   input-reclas      Month End = Input + Reclas, for every row and month
//   duplicate-column  two columns with the same name (same values or not)
//   empty-column      a Month End column with only zeros (a month not loaded yet);
//                     an empty Reclas column is normal and not listed
// A second column with the same name, and empty columns, are left out of the
// row checks, so one problem is not counted twice.
//   balance           the balance sheet's "Balance" row is 0: assets = liabilities + capital
//   earnings          the balance sheet's current-year earnings = the income
//                     statement's result so far this year (YTD)

import { fail, readJson, readJsonl, same, writeJsonl } from "./lib/jsonl.mjs";

const dir = process.argv[2];
if (!dir) fail(3, "usage: node scripts/pipeline/3-check.mjs <output folder>");
const sheets = readJson(3, dir, "1-sheets.json");
const tree = readJsonl(3, dir, "2-tree.jsonl");
const byId = new Map(tree.map((n) => [n.id, n]));
const out = [];
const round = (x) => Math.round(x * 100) / 100;
const add = (check, where, expected, got) =>
  out.push({ check, ...where, expected: round(expected), got: round(got), diff: round(got - expected) });

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

for (const s of sheets) {
  const rows = tree.filter((n) => n.sheet === s.sheet);
  const cols = s.columns;
  const name = (c) => cols[c].name;
  const empty = (c) => rows.every((r) => same(r.values[c], 0));
  const first = new Map();
  cols.forEach((c, i) => first.has(c.name) || first.set(c.name, i));
  const use = cols.map((c, i) => first.get(c.name) === i && !empty(i));
  s.use = use;

  // plain-sum
  for (const p of rows.filter((n) => n.children.length)) {
    const kids = p.children.map((id) => byId.get(id));
    cols.forEach((_, c) => {
      if (!use[c]) return;
      const sum = kids.reduce((a, k) => a + k.values[c], 0);
      if (!same(sum, p.values[c])) add("plain-sum", { sheet: s.sheet, id: p.id, label: p.label, column: name(c) }, sum, p.values[c]);
    });
  }

  // input-reclas
  const months = new Map();
  cols.forEach((c, i) => {
    if (!c.kind || !c.month) return;
    const key = `${c.month} ${c.year} ${c.measure}`;
    if (!months.has(key)) months.set(key, {});
    months.get(key)[c.kind] ??= i;
  });
  for (const [, k] of months) {
    if (k.Input === undefined || k.Reclas === undefined || k["Month End"] === undefined) continue;
    for (const r of rows) {
      const want = r.values[k.Input] + r.values[k.Reclas];
      if (!same(want, r.values[k["Month End"]]))
        add("input-reclas", { sheet: s.sheet, id: r.id, label: r.label, column: name(k["Month End"]) }, want, r.values[k["Month End"]]);
    }
  }

  // duplicate-column, empty-column
  const seen = new Map();
  cols.forEach((c, i) => {
    if (seen.has(c.name)) {
      const j = seen.get(c.name);
      const differ = rows.filter((r) => !same(r.values[i], r.values[j])).length;
      out.push({ check: "duplicate-column", sheet: s.sheet, column: c.name, columns: [j, i], rowsThatDiffer: differ });
    } else seen.set(c.name, i);
    if (first.get(c.name) === i && c.kind !== "Reclas" && empty(i)) out.push({ check: "empty-column", sheet: s.sheet, column: c.name });
  });
  // a month missing between two loaded months of the same year
  const loaded = cols.filter((c) => c.month && c.year);
  for (const y of new Set(loaded.map((c) => c.year))) {
    const idx = [...new Set(loaded.filter((c) => c.year === y).map((c) => MONTHS.indexOf(c.month)))].sort((a, b) => a - b);
    for (let m = idx[0]; m < idx.at(-1); m++)
      if (!idx.includes(m)) out.push({ check: "missing-month", sheet: s.sheet, column: `${MONTHS[m]} ${y}` });
  }

  // balance
  for (const r of rows.filter((n) => n.depth === 0 && (n.member === "Balance" || n.label === "Balance")))
    cols.forEach((_, c) => {
      if (use[c] && !same(r.values[c], 0)) add("balance", { sheet: s.sheet, id: r.id, label: r.label, column: name(c) }, 0, r.values[c]);
    });
}

// earnings: the income statement's top row (its result) against the balance
// sheet row with the same label (Smart View puts it under "Current Year Earnings").
const isSheet = sheets.find((s) => !tree.some((n) => n.sheet === s.sheet && n.depth === 0 && n.label === "Balance"));
const bsSheet = sheets.find((s) => s !== isSheet);
const isRoot = isSheet && tree.find((n) => n.sheet === isSheet.sheet && n.depth === 0);
const bsRow = isRoot && tree.find((n) => n.sheet === bsSheet.sheet && n.label === isRoot.label && n.depth > 0);
if (isRoot && bsRow) {
  const monthEnd = (s, c) => c.kind === "Month End" && c.month && c.year;
  const ytd = (month, year) => {
    const cols = isSheet.columns;
    const direct = cols.findIndex((c) => monthEnd(isSheet, c) && c.month === month && c.year === year && c.measure === "YTD");
    if (direct >= 0) return isRoot.values[direct];
    let total = 0;
    for (let m = 0; m <= MONTHS.indexOf(month); m++) {
      const c = cols.findIndex((x) => monthEnd(isSheet, x) && x.month === MONTHS[m] && x.year === year && x.measure !== "YTD");
      if (c < 0) return null;            // a month of the year is missing: cannot add up
      total += isRoot.values[c];
    }
    return total;
  };
  bsSheet.columns.forEach((c, i) => {
    if (!monthEnd(bsSheet, c) || !bsSheet.use[i]) return;
    const want = ytd(c.month, c.year);
    if (want === null) return;
    if (!same(want, bsRow.values[i]))
      add("earnings", { sheet: bsSheet.sheet, id: bsRow.id, label: bsRow.label, column: c.name, from: isRoot.id }, want, bsRow.values[i]);
    else out.push({ check: "earnings-ok", sheet: bsSheet.sheet, column: c.name });
  });
}

writeJsonl(dir, "3-checks.jsonl", out);
const count = {};
for (const x of out) count[x.check] = (count[x.check] ?? 0) + 1;
console.log(`step 3: ${Object.entries(count).map(([k, v]) => `${k} ${v}`).join(", ") || "every check passed"}`);
