#!/usr/bin/env python3
"""
Convert a debug_pairs_*.csv (pair_label, lang1, lang2, word1, word2, concept,
score, lang1_associations, lang2_associations, lang1_name, lang2_name) into
the JSON array consumed by scripts/load_cue_pairs.js.

lang1_associations / lang2_associations are semicolon-separated response
words; word1/word2 are the cue pair and are prepended to rows/cols (matching
the convention in src/taskData.js, where the cue word appears as its own
row/col so annotators can judge the direct cue-to-cue equivalence too).

Usage:
    python scripts/csv_to_cue_pairs.py debug_pairs_cmn.csv > cue_pairs.json
"""
import sys
import csv
import json
import re


def slug(s):
    # \w with re.UNICODE (default in Python 3) keeps CJK characters,
    # unlike an ASCII-only [a-zA-Z0-9] class which would strip them
    # entirely and collide every Chinese cue word into "_".
    return re.sub(r"[^\w]+", "_", s).strip("_").lower()


# Some upstream rows contain hex-hash-looking artifacts instead of a real
# word (seen in the CMN debug set) — drop those rather than showing
# annotators a stray hash to score.
_HASH_LIKE = re.compile(r"^[0-9a-f]{16,}$", re.IGNORECASE)

LANG_CODE = {
    "eng": "en",
    "en": "en",
    "cmn": "zh",
    "zh": "zh",
    "nl": "nl",
    "de": "de",
    "spa": "es",
    "es": "es",
}


def normalize_lang(code):
    normalized = code.strip().lower()
    return LANG_CODE.get(normalized, normalized)


def split_assoc(cell):
    words = [w.strip() for w in cell.split(";") if w.strip()]
    return [w for w in words if not _HASH_LIKE.match(w)]


def main(path):
    out = []
    seen_ids = {}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            word1, word2 = row["word1"].strip(), row["word2"].strip()
            base_id = f"{slug(word1)}_{slug(word2)}"
            n = seen_ids.get(base_id, 0)
            seen_ids[base_id] = n + 1
            pair_id = base_id if n == 0 else f"{base_id}_{n}"

            rows = [word1] + split_assoc(row["lang1_associations"])
            cols = [word2] + split_assoc(row["lang2_associations"])

            out.append({
                "id": pair_id,
                "cueL1": {"w": word1, "lang": normalize_lang(row["lang1"])},
                "cueL2": {"w": word2, "lang": normalize_lang(row["lang2"])},
                "cols": cols,
                "rows": [{"w": w, "gloss": ""} for w in rows],
                "gold": [],
            })
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python csv_to_cue_pairs.py <debug_pairs.csv>")
    main(sys.argv[1])
