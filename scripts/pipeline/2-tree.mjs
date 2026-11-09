// Step 2, tree: rebuild the account tree from the indentation and find each
// account in the catalog.
//
// Run: node scripts/pipeline/2-tree.mjs <output folder>
// Reads 1-rows.jsonl, 1-catalog.jsonl. Writes 2-tree.jsonl: the rows plus
// "id", "parent", "children", and the catalog match:
//   member    the catalog member this row is (null if none found)
//   match     how it was found: member | alias | code | children | null
//   op        the catalog's operator for this member (+ - ~), meant towards its catalog parent
//   agrees    true if the catalog parent of the member is the member of the row's parent
//
// Account rows carry a code ("Entity_010-1001_Cash and Banks" is member
// Entity_010-1001). The summary rows have English names and the catalog
// Spanish ones, so those are found through their children: if every matched
// child has the same catalog parent, that parent is this row.

import { fail, readJsonl, writeJsonl } from "./lib/jsonl.mjs";

const dir = process.argv[2];
if (!dir) fail(2, "usage: node scripts/pipeline/2-tree.mjs <output folder>");
const rows = readJsonl(2, dir, "1-rows.jsonl");
const catalog = readJsonl(2, dir, "1-catalog.jsonl");
const warnings = [];
const warn = (kind, msg, where) => {
  warnings.push({ step: 2, kind, msg, ...where });
};

const byMember = new Map(catalog.map((m) => [m.member, m]));
const byAlias = new Map();
for (const m of catalog) if (m.alias && !byAlias.has(m.alias)) byAlias.set(m.alias, m);

// The tree: a row's parent is the nearest row above it with a smaller depth.
const nodes = rows.map((r) => ({ id: `${r.sheet}:${r.row}`, ...r, parent: null, children: [] }));
const stack = [];
nodes.forEach((n, i) => {
  if (i > 0 && nodes[i - 1].sheet !== n.sheet) stack.length = 0;
  while (stack.length && stack.at(-1).depth >= n.depth) stack.pop();
  if (stack.length) {
    n.parent = stack.at(-1).id;
    stack.at(-1).children.push(n.id);
  } else if (n.depth !== 0) {
    fail(2, `${n.id} (${n.label}) has depth ${n.depth} but no row above it to belong to`);
  }
  stack.push(n);
});
const byId = new Map(nodes.map((n) => [n.id, n]));

function direct(label) {
  if (byMember.has(label)) return [byMember.get(label), "member"];
  if (byAlias.has(label)) return [byAlias.get(label), "alias"];
  const code = label.match(/^([A-Za-z]+_[\d-]+)(?:_|$)/);
  if (code && byMember.has(code[1])) return [byMember.get(code[1]), "code"];
  return [null, null];
}

// Bottom-up, so children are matched before their parent.
for (const n of [...nodes].reverse()) {
  let [m, how] = direct(n.label);
  const kids = n.children.map((id) => byId.get(id)).filter((k) => k.member);
  if (!m && kids.length) {
    const votes = new Map();
    for (const k of kids) {
      const p = byMember.get(k.member).parent;
      if (p) votes.set(p, (votes.get(p) ?? 0) + 1);
    }
    const ranked = [...votes].sort((a, b) => b[1] - a[1]);
    if (ranked.length && byMember.has(ranked[0][0])) {
      m = byMember.get(ranked[0][0]);
      how = "children";
      if (ranked.length > 1)
        warn("mixed-children", `${n.label}: its children belong to ${ranked.length} catalog parents (${ranked.map(([p, c]) => `${p} ×${c}`).join(", ")}); took ${m.member}`, { id: n.id });
    }
  }
  n.member = m?.member ?? null;
  n.match = how;
  n.op = m?.op ?? null;
}
for (const n of nodes) {
  const p = n.parent && byId.get(n.parent);
  n.agrees = n.member && p?.member ? byMember.get(n.member).parent === p.member : null;
  if (!n.member) warn("unmatched", `${n.label} is not in the catalog`, { id: n.id });
  else if (n.agrees === false)
    warn("other-parent", `${n.label}: the catalog puts ${n.member} under ${byMember.get(n.member).parent}, the report under ${p.label} (${p.member})`, { id: n.id });
}

writeJsonl(dir, "2-tree.jsonl", nodes.map(({ id, sheet, row, depth, label, parent, children, member, match, op, agrees, values }) =>
  ({ id, sheet, row, depth, label, parent, children, member, match, op, agrees, values })));
writeJsonl(dir, "2-warnings.jsonl", warnings);

const count = (f) => nodes.filter(f).length;
console.log(`step 2: ${nodes.length} rows, ${count((n) => n.children.length)} with children`);
console.log(`step 2: catalog match: ${["member", "alias", "code", "children"].map((h) => `${h} ${count((n) => n.match === h)}`).join(", ")}, none ${count((n) => !n.member)}`);
console.log(`step 2: same parent as in the catalog: ${count((n) => n.agrees === true)}, other parent: ${count((n) => n.agrees === false)}`);
