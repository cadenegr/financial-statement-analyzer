// Step 5, report: everything the steps found, for a person to read, and the
// statements as clean structured data.
//
// Run: node scripts/pipeline/5-report.mjs <output folder>
// Reads every file the steps before wrote. Writes:
//   5-accounts.jsonl  one line per account: tree, catalog member, sign, and
//                     its amounts by column name (loaded columns only)
//   report.md         the findings

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fail, readJson, readJsonl, same, writeJsonl } from "./lib/jsonl.mjs";

const dir = process.argv[2];
if (!dir) fail(5, "usage: node scripts/pipeline/5-report.mjs <output folder>");
const sheets = readJson(5, dir, "1-sheets.json");
const catalog = readJsonl(5, dir, "1-catalog.jsonl");
const tree = readJsonl(5, dir, "2-tree.jsonl");
const checks = readJsonl(5, dir, "3-checks.jsonl");
const groups = readJsonl(5, dir, "4-groups.jsonl");
const signs = readJsonl(5, dir, "4-signs.jsonl");
const warnings = [...readJsonl(5, dir, "1-warnings.jsonl"), ...readJsonl(5, dir, "2-warnings.jsonl")];
const byId = new Map(tree.map((n) => [n.id, n]));
const signOf = new Map(signs.map((s) => [s.id, s]));
const byMember = new Map(catalog.map((m) => [m.member, m]));

const money = (x) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const loaded = new Map(sheets.map((s) => {
  const rows = tree.filter((n) => n.sheet === s.sheet);
  const first = new Map();
  s.columns.forEach((c, i) => first.has(c.name) || first.set(c.name, i));
  return [s.sheet, s.columns.map((_, i) => i).filter((i) => first.get(s.columns[i].name) === i && rows.some((r) => !same(r.values[i], 0)))];
}));

// The clean data.
writeJsonl(dir, "5-accounts.jsonl", tree.map((n) => {
  const s = sheets.find((x) => x.sheet === n.sheet);
  return {
    id: n.id, sheet: n.sheet, depth: n.depth, label: n.label, parent: n.parent,
    member: n.member, catalogName: n.member && byMember.get(n.member).alias,
    sign: signOf.get(n.id)?.sign ?? null,
    amounts: Object.fromEntries(loaded.get(n.sheet).map((i) => [s.columns[i].name, Math.round(n.values[i] * 100) / 100])),
  };
}));

// The report.
const L = [];
const of = (k) => checks.filter((c) => c.check === k);
L.push(`# Financial statements check: ${dir.split("/").pop()}`, "");
L.push(`Pipeline: read → tree → check → engine → report (scripts/pipeline/run.mjs).`, "");
L.push("## What was read", "");
for (const s of sheets) {
  const rows = tree.filter((n) => n.sheet === s.sheet);
  const cols = loaded.get(s.sheet).map((i) => s.columns[i].name);
  L.push(`- **${s.sheet}**: ${rows.length} rows, ${s.columns.length} columns (${cols.length} with data: ${cols[0]} … ${cols.at(-1)}). Page: ${s.page.join(" / ")}.`);
}
L.push(`- **Catalog**: ${catalog.length} members (${catalog.filter((m) => m.op === "-").length} subtracted, ${catalog.filter((m) => m.op === "~").length} ignored).`, "");

L.push("## Problems found", "");
const problems = [];
for (const c of of("balance"))
  problems.push(`**The balance sheet does not balance in ${c.column}**: ${c.label} = ${money(c.got)} (assets minus liabilities and capital should be 0).`);
for (const c of of("earnings")) {
  const r = byId.get(c.id);
  problems.push(`**Earnings do not match in ${c.column}**: the balance sheet's current-year earnings (${r.label}, row ${r.row}) are ${money(c.got)}, the income statement adds up to ${money(c.expected)} so far this year (difference ${money(c.diff)}).`);
}
const ok = of("earnings-ok").map((c) => c.column);
if (ok.length) problems.push(`Earnings match in ${ok.length} months (${ok[0]} … ${ok.at(-1)}), so the link between the two sheets is right until then.`);
for (const c of of("duplicate-column"))
  problems.push(`Column **${c.column}** appears twice in ${c.sheet} (${c.rowsThatDiffer ? `${c.rowsThatDiffer} rows differ` : "same values"}): probably a header mistake.`);
for (const c of of("missing-month")) problems.push(`**${c.column}** is missing from ${c.sheet}.`);
const empty = of("empty-column");
if (empty.length) problems.push(`Not loaded yet (only zeros): ${empty.map((c) => `${c.column} (${c.sheet.split(" ")[0]})`).join(", ")}.`);
const ir = of("input-reclas");
problems.push(ir.length ? `${ir.length} rows where Month End ≠ Input + Reclas.` : "Month End = Input + Reclas holds on every row and month.");
for (const w of warnings.filter((w) => w.step === 1)) problems.push(`Catalog: ${w.msg}.`);
const unmatched = tree.filter((n) => !n.member);
if (unmatched.length) {
  problems.push(`**${unmatched.length} rows are not in the catalog**:`);
  for (const n of unmatched) {
    const s = sheets.find((x) => x.sheet === n.sheet);
    const used = loaded.get(n.sheet).filter((i) => !same(n.values[i], 0)).map((i) => s.columns[i].name);
    problems.push(`  - ${n.label} (${n.sheet} row ${n.row}, under ${byId.get(n.parent)?.label ?? "-"}): ${used.length ? `amounts in ${used.length === loaded.get(n.sheet).length ? "every month" : used.join(", ")}` : "no amounts"}`);
  }
}
L.push(...problems.map((p) => (p.startsWith("  ") ? p : `- ${p}`)), "");

L.push("## What the summary rows are", "");
L.push("The report's English names, and the catalog member each one is (found through its children):", "");
L.push("| Sheet | Row | Report says | Catalog member |", "|---|---|---|---|");
for (const n of tree.filter((n) => n.depth <= 2 && n.children.length))
  L.push(`| ${n.sheet} | ${n.row} | ${"  ".repeat(n.depth)}${n.label} | ${n.member ?? "–"} |`);
L.push("");
for (const n of tree.filter((n) => n.depth === 0 && n.member && n.label !== n.member))
  L.push(`Note: the top row of ${n.sheet} says **${n.label}** but is catalog member **${n.member}**.`);
L.push("");

L.push("## Signs (found by the engine)", "");
const solved = groups.filter((g) => g.how === "solved").length;
const few = groups.filter((g) => g.search?.startsWith("few"));
const found = signs.filter((s) => s.sign);
const cmp = signs.filter((s) => s.agrees !== null);
L.push(`Every parent row was turned into a puzzle: each child is a cell (+, - or ignored), each month a group of the sign patterns that make that month add up. The engine cross-checks the months.`, "");
L.push(`- ${solved} of ${groups.length} parents solved with exactly one answer, ${groups.reduce((a, g) => a + (g.guesses ?? 0), 0)} guesses in all.`);
if (few.length) L.push(`- ${few.length} big parents (${few.map((g) => `${g.label} ${g.children}`).join(", ")} children) were searched with at most 2 exceptions per month; the answer is unique among those.`);
L.push(`- ${found.length} of ${signs.length} children got a sign: ${["+", "-", "~"].map((x) => `${x} ${found.filter((s) => s.sign === x).length}`).join(", ")}.`);
L.push(`- Against the catalog: ${cmp.filter((s) => s.agrees).length} of ${cmp.length} agree, ${cmp.filter((s) => !s.agrees).length} disagree. ${signs.length - cmp.length} children cannot be compared (not in the catalog).`, "");
for (const g of groups.filter((g) => g.how !== "solved")) L.push(`- **${g.label}**: ${g.how}${g.column ? ` (no pattern fits ${g.column})` : ""}`);
L.push("The statements as formulas (every parent with a child that is not added):", "", "```");
for (const p of tree.filter((n) => n.children.some((id) => signOf.get(id)?.sign !== "+"))) {
  const parts = p.children.map((id, k) => {
    const s = signOf.get(id).sign ?? "?";
    const name = byId.get(id).label;
    return k === 0 ? (s === "+" ? name : `${s} ${name}`) : `${s} ${name}`;
  });
  L.push(`${p.label} = ${parts.join(" ")}`);
}
L.push("```", "");

L.push("## Files", "");
L.push("- `5-accounts.jsonl`: every account with its parent, catalog member, sign and amounts by month.");
L.push("- `4-maps/`: the puzzles given to the engine, one per parent.");
L.push("- `3-checks.jsonl`: every check that failed (plain-sum failures are the subtracted children above).");
writeFileSync(join(dir, "report.md"), L.join("\n") + "\n");
console.log(`step 5: wrote ${join(dir, "report.md")} and 5-accounts.jsonl (${tree.length} accounts)`);
