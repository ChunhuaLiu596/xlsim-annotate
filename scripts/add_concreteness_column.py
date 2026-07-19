#!/usr/bin/env python3
"""
Add a cueL1_concreteness column to data/cue_pairs_preview.csv, matched from
Brysbaert et al. (2014) norms (Word, Conc.M) against cueL1_word (always the
English side of each pair). Overwrites the CSV in place; leaves the column
blank for any anchor not found in Brysbaert.

Usage:
    python scripts/add_concreteness_column.py
"""
import csv
import sys
import pandas as pd

PREVIEW_CSV = "data/cue_pairs_preview.csv"
BRYSBAERT_XLSX = "data/Brysbaert2014_Concreteness.xlsx"


def main():
    brys = pd.read_excel(BRYSBAERT_XLSX, sheet_name="Sheet1")
    conc = dict(zip(brys["Word"].str.lower().str.strip(), brys["Conc.M"]))

    with open(PREVIEW_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        rows = list(reader)

    if "cueL1_concreteness" not in fieldnames:
        fieldnames = fieldnames + ["cueL1_concreteness"]

    matched = 0
    for row in rows:
        w = row["cueL1_word"].strip().lower()
        v = conc.get(w)
        row["cueL1_concreteness"] = f"{v:.2f}" if v is not None else ""
        if v is not None:
            matched += 1

    with open(PREVIEW_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"matched {matched}/{len(rows)} rows, wrote {PREVIEW_CSV}", file=sys.stderr)


if __name__ == "__main__":
    main()
