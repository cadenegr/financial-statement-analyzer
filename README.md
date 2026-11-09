# Financial statement analyzer

Checks an Oracle Hyperion **Smart View** Excel export of a balance sheet and an
income statement, and writes a report of what is wrong with it.

Given one `.xlsx` export, it:

1. reads the statement sheets and the account catalog,
2. rebuilds the account tree from the indentation,
3. checks the rules a set of statements must follow (sums, balance, the link
   between the two statements, duplicate or empty month columns),
4. works out which accounts are added and which are subtracted, using a small
   constraint engine, and compares the result with the catalog,
5. writes `report.md` with the problems found and the statements as formulas.

The figures are only read, never adjusted.

## Requirements

- Node.js 18 or later (developed on 24)
- Python 3.10 or later, with `openpyxl` (step 1 only)
- A C compiler and `make` (for the engine)

## Setup

```sh
python3 -m venv .venv
.venv/bin/pip install openpyxl
make -C engine            # builds engine/map-engine (run.mjs also does this if it is missing)
```

## Run

```sh
node scripts/pipeline/run.mjs "path/to/export.xlsx"
```

Everything goes to `.cache/pipeline/<file name>/`. Start with `report.md`.

| File | Step | Contents |
|---|---|---|
| `1-sheets.json`, `1-rows.jsonl`, `1-catalog.jsonl`, `1-warnings.jsonl` | 1 read | sheets, columns, account rows, catalog, data warnings |
| `2-tree.jsonl`, `2-warnings.jsonl` | 2 tree | each row with its parent and catalog member |
| `3-checks.jsonl` | 3 check | one line per check that failed |
| `4-maps/`, `4-groups.jsonl`, `4-signs.jsonl` | 4 engine | one puzzle per parent account, and the signs found |
| `5-accounts.jsonl`, `report.md` | 5 report | every account with sign and monthly amounts; the report |

Each step can also be run alone. Its usage line is at the top of its file in
`scripts/pipeline/`.

## What the export must look like

- **Statement sheets** (for example `BS ACTUAL` and `IS ACTUAL`): header rows
  on top, then one row per account. The first column holds the account name,
  indented by 5 spaces per tree level, as Smart View writes it. Column headers
  are read for month, `FY..` year, `Input` / `Reclas` / `Month End`, and
  `YTD Amount`.
- **Catalog sheet**: one row per member, with columns starting with
  `Miembro padre` / `Parent`, `Operador de consolidación` / `Consolidation`
  and `Tabla de alias` / `Alias`.

When something does not fit, the step stops with a message that names the
sheet and row.

## Checks

| Check | Rule |
|---|---|
| `plain-sum` | parent = sum of its children (fails where a child is subtracted, which step 4 then explains) |
| `input-reclas` | Month End = Input + Reclas, every row and month |
| `balance` | the balance sheet's Balance row is 0 (assets = liabilities + capital) |
| `earnings` | current-year earnings on the balance sheet = year-to-date result of the income statement |
| `duplicate-column` | a month column appears twice |
| `empty-column` | a Month End column with only zeros (month not loaded yet) |
| `missing-month` | a month is missing from the sequence |

## The engine

`engine/` is a constraint solver written in C. For each parent account, every
child is a cell that can be `+`, `-` or ignored. Each month adds a group of
the sign patterns that make that month add up. The engine finds the patterns
that fit all months at once.

The core is copied from
[cadenegr/skyscrapers](https://github.com/cadenegr/skyscrapers) (see
`engine/core/README.md`; change it there, not here). With exact amounts, a
single month usually allows only one pattern, so here the engine mostly
cross-checks months. It would matter more for linked problems, such as an
account tree without indentation or intercompany matching.

## Data

Client exports (`*.xlsx`, `*.csv`), the `.cache/` outputs and `reports/` are
git-ignored on purpose: they hold real company figures. Keep it that way.
