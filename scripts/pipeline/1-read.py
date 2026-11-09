"""Step 1, read: a Smart View (Hyperion) Excel export -> plain JSONL.

Run: .venv/bin/python scripts/pipeline/1-read.py <file.xlsx> <output folder>
Writes:
  1-sheets.json    each statement sheet: page labels (USD, entity...) and its columns
  1-rows.jsonl     one line per account row: sheet, row, depth, label, values
  1-catalog.jsonl  the account catalog: member, parent, operator (+ - ~), alias
  1-warnings.jsonl problems in the data that do not stop the pipeline

Python only for this step: openpyxl is the most reliable .xlsx reader. The
later steps are Node, like the deutsch-sarge-drill pipeline.
Setup once:  python3 -m venv .venv && .venv/bin/pip install openpyxl
"""

import json
import os
import sys

import openpyxl

INDENT = 5  # Smart View indents each level of the account tree by 5 spaces
OPERATORS = {"Suma": "+", "Resta": "-", "Omitir": "~", "Addition": "+", "Subtraction": "-", "Ignore": "~"}


WARNINGS = []


def warn(kind, msg, **where):
    WARNINGS.append({"step": 1, "kind": kind, "msg": msg, **where})
    print(f"step 1: warning: {msg}", file=sys.stderr)


def fail(msg):
    print(f"step 1: {msg}", file=sys.stderr)
    sys.exit(1)


def is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def read_catalog(rows):
    """The catalog sheet: first column is the member, then a header row names the rest."""
    head = [str(h or "").strip() for h in rows[0]]

    def col(*names):
        for n in names:
            for i, h in enumerate(head):
                if h.lower().startswith(n.lower()):
                    return i
        fail(f"catalog has no column starting with {names}")

    c_parent = col("Miembro padre", "Parent")
    c_op = col("Operador de consolidación", "Consolidation")
    c_alias = col("Tabla de alias", "Alias")
    out, seen = [], set()
    for r in rows[1:]:
        if r[0] is None:
            continue
        member = str(r[0]).strip()
        if member != str(r[0]).strip(" "):
            warn("hidden-space", f"catalog member {str(r[0])!r} has a hidden space (non-breaking) around its name", member=member)
        if member in seen:
            warn("duplicate", f"catalog member {member!r} appears twice: the second one is dropped", member=member)
            continue
        seen.add(member)
        op = OPERATORS.get(str(r[c_op] or "").strip())
        if op is None:
            fail(f"catalog member {member!r} has an unknown operator {r[c_op]!r}")
        out.append({"member": member, "parent": str(r[c_parent] or "").strip() or None,
                    "op": op, "alias": str(r[c_alias] or "").strip() or None})
    for m in out:
        if m["parent"] and m["parent"] not in seen and m["parent"] != "Account":
            warn("no-parent", f"catalog parent {m['parent']!r} of {m['member']!r} is not a member", member=m["member"])
    return out


MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]


def describe(header):
    """Pick the month, year, kind (Input / Reclas / Month End) and measure out of a column's labels."""
    month = next((h for h in header if h in MONTHS), None)
    year = next((h for h in header if h.startswith("FY") and h[2:].isdigit()), None)
    kind = next((h for h in header if h in ("Input", "Reclas", "Month End")), None)
    measure = "YTD" if "YTD Amount" in header else "period" if "Amount" in header else None
    short = " ".join(x for x in (month[:3] if month else None, year, kind, "YTD" if measure == "YTD" else None) if x)
    return {"month": month, "year": year, "kind": kind, "measure": measure, "name": short or " ".join(header)}


def read_statement(name, rows):
    """A statement sheet: header rows on top, then one row per account."""
    first = next((i for i, r in enumerate(rows)
                  if isinstance(r[0], str) and r[0].strip() and any(is_number(v) for v in r[1:])), None)
    if first is None:
        fail(f"sheet {name!r} has no account rows")
    ncols = max(len(r) for r in rows) - 1
    page, columns = [], [[] for _ in range(ncols)]
    for r in rows[:first]:
        filled = [(j, str(v).strip()) for j, v in enumerate(r[1:]) if v is not None and str(v).strip()]
        if len(filled) * 2 < ncols:          # a few labels spread over the row: they name the whole page
            page += [v for _, v in filled]
        else:
            for j, v in filled:
                columns[j].append(v)
    used = [j for j in range(ncols) if columns[j]]
    cols = [{"col": k, "header": columns[j], **describe(columns[j])} for k, j in enumerate(used)]

    out = []
    for i, r in enumerate(rows[first:], first + 1):
        if r[0] is None or not str(r[0]).strip():
            continue
        raw = str(r[0])
        spaces = len(raw) - len(raw.lstrip(" "))
        if spaces % INDENT:
            fail(f"{name} row {i}: indent of {spaces} spaces is not a multiple of {INDENT}")
        values = []
        for j in used:
            v = r[j + 1] if j + 1 < len(r) else None
            if v is not None and not is_number(v):
                fail(f"{name} row {i}: {v!r} is not a number")
            values.append(float(v or 0))
        out.append({"sheet": name, "row": i, "depth": spaces // INDENT, "label": raw.strip(), "values": values})
    for a, b in zip(out, out[1:]):
        if b["depth"] > a["depth"] + 1:
            fail(f"{name} row {b['row']}: jumps from depth {a['depth']} to {b['depth']}")
    return {"sheet": name, "page": page, "first_row": first + 1, "columns": cols}, out


def main():
    if len(sys.argv) != 3:
        fail("usage: .venv/bin/python scripts/pipeline/1-read.py <file.xlsx> <output folder>")
    path, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheets, rows, catalog = [], [], None
    for ws in wb.worksheets:
        data = [tuple(r) for r in ws.iter_rows(values_only=True)]
        if not data:
            continue
        head = " ".join(str(v) for v in data[0] if v is not None).lower()
        if "padre" in head or "parent" in head:
            if catalog is not None:
                fail("two catalog sheets")
            catalog = read_catalog(data)
        else:
            info, r = read_statement(ws.title, data)
            sheets.append(info)
            rows += r
    if catalog is None:
        fail("no catalog sheet (a sheet with a 'Miembro padre' / 'Parent' column)")

    with open(os.path.join(outdir, "1-sheets.json"), "w") as f:
        json.dump(sheets, f, ensure_ascii=False, indent=1)
    with open(os.path.join(outdir, "1-rows.jsonl"), "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    with open(os.path.join(outdir, "1-catalog.jsonl"), "w") as f:
        for m in catalog:
            f.write(json.dumps(m, ensure_ascii=False) + "\n")
    with open(os.path.join(outdir, "1-warnings.jsonl"), "w") as f:
        for w in WARNINGS:
            f.write(json.dumps(w, ensure_ascii=False) + "\n")
    for s in sheets:
        n = sum(1 for r in rows if r["sheet"] == s["sheet"])
        print(f"step 1: {s['sheet']}: {n} rows, {len(s['columns'])} columns, page {' / '.join(s['page'])}")
    print(f"step 1: catalog: {len(catalog)} members")


main()
