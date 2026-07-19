#!/usr/bin/env python3
"""
Merge the two converted cue-pair JSON files into one preview set, and emit
both a JSON array (for scripts/load_cue_pairs.js) and a flat CSV (for
eyeballing in a spreadsheet before seeding).

Usage:
    python scripts/tsv_to_cue_pairs.py data/translation_parallel_complete_selected.csv \
        --mode translation_parallel > /tmp/tp_pairs.json
    python scripts/tsv_to_cue_pairs.py data/simlex_shared_english_anchor_complete_selected.csv \
        --mode simlex_swap > /tmp/simlex_pairs.json
    python scripts/build_cue_pairs_preview.py /tmp/tp_pairs.json /tmp/simlex_pairs.json
"""
import sys
import json
import csv

OUT_JSON = "data/cue_pairs_preview.json"
OUT_CSV = "data/cue_pairs_preview.csv"


def main(paths):
    merged = []
    for p in paths:
        merged.extend(json.load(open(p, encoding="utf-8")))

    ids = [p["id"] for p in merged]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        sys.exit(f"duplicate ids across inputs, aborting: {sorted(dupes)[:10]}")

    json.dump(merged, open(OUT_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    with open(OUT_CSV, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["id", "source", "cueL1_word", "cueL1_lang", "cueL2_word", "cueL2_lang",
                    "n_rows", "n_cols", "row_words", "col_words"])
        for p in merged:
            w.writerow([
                p["id"], p.get("source", ""), p["cueL1"]["w"], p["cueL1"]["lang"],
                p["cueL2"]["w"], p["cueL2"]["lang"],
                len(p["rows"]), len(p["cols"]),
                "; ".join(r["w"] for r in p["rows"]),
                "; ".join(p["cols"]),
            ])

    print(f"wrote {len(merged)} pairs -> {OUT_JSON}, {OUT_CSV}", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: python build_cue_pairs_preview.py <pairs1.json> [pairs2.json ...]")
    main(sys.argv[1:])
