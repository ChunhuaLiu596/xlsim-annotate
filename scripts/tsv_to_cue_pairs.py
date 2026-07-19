#!/usr/bin/env python3
"""
Convert the two tab-separated SWOW cross-lingual source files into the JSON
array consumed by scripts/load_cue_pairs.js.

Two input shapes, two --mode values:

  translation_parallel  (translation_parallel_complete_selected.csv)
    One ENG anchor word per row, plus up to 5 candidate translations per
    language (CMN 1-5, NL 1-5, SPA 1-5, DE 1-5), each with its own
    "<slot>_Associations" column. Each non-empty (ENG, <lang> N) slot
    becomes one cue pair: cue1 = ENG, cue2 = that candidate.

  simlex_swap  (simlex_shared_english_anchor_complete_selected.csv)
    One English word PAIR per row (ENG 1, ENG 2, e.g. "size"/"magnitude"),
    each translated into CMN/SPA/NL/DE (word + associations for both slot
    1 and slot 2). Per user decision: build SWAPPED cross-lingual pairs —
    (ENG 1, <lang> 2) and (ENG 2, <lang> 1) — for all four languages,
    since the point is testing whether the translated word preserves the
    ENG1<->ENG2 relationship.

Pairs where either side has no association list are skipped (can't build
a matrix with zero rows or columns).

Usage:
    python scripts/tsv_to_cue_pairs.py translation_parallel_complete_selected.csv \
        --mode translation_parallel > tp_pairs.json
    python scripts/tsv_to_cue_pairs.py simlex_shared_english_anchor_complete_selected.csv \
        --mode simlex_swap > simlex_pairs.json
"""
import sys
import csv
import json
import re
import argparse

LANGS = ["CMN", "NL", "SPA", "DE"]
LANG_CODE = {"ENG": "en", "CMN": "zh", "NL": "nl", "SPA": "es", "DE": "de"}


def slug(s):
    return re.sub(r"[^\w]+", "_", s).strip("_").lower()


def split_assoc(cell):
    return [w.strip() for w in cell.split(";") if w.strip()]


def read_tsv(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f, delimiter="\t"))


def make_pair(pair_id, w1, lang1, assoc1, w2, lang2, assoc2, source):
    return {
        "id": pair_id,
        "source": source,  # "translation_parallel" | "simlex_swap" — which raw file this came from
        "cueL1": {"w": w1, "lang": LANG_CODE.get(lang1, lang1.lower())},
        "cueL2": {"w": w2, "lang": LANG_CODE.get(lang2, lang2.lower())},
        "cols": [w2] + split_assoc(assoc2),
        "rows": [{"w": w, "gloss": ""} for w in [w1] + split_assoc(assoc1)],
        "gold": [],
    }


def convert_translation_parallel(rows):
    out = []
    seen = {}
    skipped = 0
    for row in rows:
        eng = row["ENG"].strip()
        eng_assoc = row.get("ENG_Associations", "").strip()
        if not eng or not eng_assoc:
            skipped += 1
            continue
        for lang in LANGS:
            for n in "12345":
                w = row.get(f"{lang} {n}", "").strip()
                assoc = row.get(f"{lang} {n}_Associations", "").strip()
                if not w:
                    continue
                if not assoc:
                    skipped += 1
                    continue
                base_id = f"{slug(eng)}_{slug(lang)}{n}_{slug(w)}"
                k = seen.get(base_id, 0)
                seen[base_id] = k + 1
                pair_id = base_id if k == 0 else f"{base_id}_{k}"
                out.append(make_pair(pair_id, eng, "ENG", eng_assoc, w, lang, assoc, "translation_parallel"))
    print(f"[translation_parallel] {len(out)} pairs, {skipped} skipped (missing word/associations)", file=sys.stderr)
    return out


def convert_simlex_swap(rows):
    out = []
    seen = {}
    skipped = 0
    for row in rows:
        eng1 = row.get("ENG 1", "").strip()
        eng2 = row.get("ENG 2", "").strip()
        eng1_assoc = row.get("ENG 1_Associations", "").strip()
        eng2_assoc = row.get("ENG 2_Associations", "").strip()
        for lang in LANGS:
            lang1 = row.get(f"{lang} 1", "").strip()
            lang2 = row.get(f"{lang} 2", "").strip()
            lang1_assoc = row.get(f"{lang} 1_Associations", "").strip()
            lang2_assoc = row.get(f"{lang} 2_Associations", "").strip()

            # swap 1: ENG 1 <-> lang 2
            if eng1 and eng1_assoc and lang2 and lang2_assoc:
                base_id = f"{slug(eng1)}_{slug(lang)}_{slug(lang2)}"
                k = seen.get(base_id, 0); seen[base_id] = k + 1
                pid = base_id if k == 0 else f"{base_id}_{k}"
                out.append(make_pair(pid, eng1, "ENG", eng1_assoc, lang2, lang, lang2_assoc, "simlex_swap"))
            else:
                skipped += 1

            # swap 2: ENG 2 <-> lang 1
            if eng2 and eng2_assoc and lang1 and lang1_assoc:
                base_id = f"{slug(eng2)}_{slug(lang)}_{slug(lang1)}"
                k = seen.get(base_id, 0); seen[base_id] = k + 1
                pid = base_id if k == 0 else f"{base_id}_{k}"
                out.append(make_pair(pid, eng2, "ENG", eng2_assoc, lang1, lang, lang1_assoc, "simlex_swap"))
            else:
                skipped += 1
    print(f"[simlex_swap] {len(out)} pairs, {skipped} skipped (missing word/associations)", file=sys.stderr)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv_path")
    ap.add_argument("--mode", required=True, choices=["translation_parallel", "simlex_swap"])
    args = ap.parse_args()

    rows = read_tsv(args.csv_path)
    if args.mode == "translation_parallel":
        out = convert_translation_parallel(rows)
    else:
        out = convert_simlex_swap(rows)
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
