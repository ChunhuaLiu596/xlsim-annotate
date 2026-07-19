#!/usr/bin/env python3
"""
Summarize distributions over data/cue_pairs_preview.csv + the two raw source
files (for fields not carried into the converted pairs, like PoS and
Ontological_Category/Semantic_Field), plus Brysbaert (2014) concreteness
norms matched onto each pair's English anchor (cueL1_word).

Requires cueL1_concreteness already populated in cue_pairs_preview.csv —
run scripts/add_concreteness_column.py first if that column is missing.

Usage:
    python scripts/cue_pairs_stats.py
Outputs:
    logs/<date>_cue_pairs_stats.txt
    logs/<date>_concreteness_distribution.png
"""
import csv
import sys
from datetime import date
from collections import Counter

import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

PREVIEW_CSV = "data/cue_pairs_preview.csv"
SIMLEX_CSV = "data/simlex_shared_english_anchor_complete_selected.csv"
TP_CSV = "data/translation_parallel_complete_selected.csv"

BAR_COLOR = "#2a78d6"
GRID_COLOR = "#e1e0d9"
AXIS_COLOR = "#c3c2b7"
TEXT_PRIMARY = "#0b0b0b"
TEXT_SECONDARY = "#52514e"
SURFACE = "#fcfcfb"


def pct(n, total):
    return f"{n} ({100*n/total:.1f}%)"


def main():
    today = date.today().isoformat()
    lines = []

    def emit(s=""):
        lines.append(s)

    with open(PREVIEW_CSV, newline="", encoding="utf-8") as f:
        pairs = list(csv.DictReader(f))
    total = len(pairs)
    emit(f"Total cue pairs: {total}\n")

    emit("=== by source ===")
    for k, v in Counter(p["source"] for p in pairs).most_common():
        emit(f"  {k}: {pct(v, total)}")

    emit("\n=== by target language (cueL2_lang) ===")
    for k, v in Counter(p["cueL2_lang"] for p in pairs).most_common():
        emit(f"  {k}: {pct(v, total)}")

    emit("\n=== row count (matrix size) distribution ===")
    n_rows = [int(p["n_rows"]) for p in pairs]
    n_cols = [int(p["n_cols"]) for p in pairs]
    for label, vals in [("rows", n_rows), ("cols", n_cols)]:
        vals_sorted = sorted(vals)
        mid = vals_sorted[len(vals_sorted)//2]
        emit(f"  {label}: min={min(vals)} median={mid} max={max(vals)} mean={sum(vals)/len(vals):.1f}")

    # --- fields only available on the raw source rows, not per-generated-pair ---
    with open(SIMLEX_CSV, newline="", encoding="utf-8") as f:
        simlex_rows = list(csv.DictReader(f, delimiter="\t"))
    emit(f"\n=== SimLex source rows: PoS_x (n={len(simlex_rows)} source rows, not per-pair) ===")
    for k, v in Counter(r["PoS_x"].strip() or "(blank)" for r in simlex_rows).most_common():
        emit(f"  {k}: {pct(v, len(simlex_rows))}")

    emit(f"\n=== SimLex source rows: scores (numeric similarity) ===")
    scores = [float(r["scores"]) for r in simlex_rows if r["scores"].strip()]
    scores_sorted = sorted(scores)
    emit(f"  n={len(scores)} min={min(scores):.2f} median={scores_sorted[len(scores_sorted)//2]:.2f} "
         f"max={max(scores):.2f} mean={sum(scores)/len(scores):.2f}")

    with open(TP_CSV, newline="", encoding="utf-8-sig") as f:
        tp_rows = list(csv.DictReader(f, delimiter="\t"))
    emit(f"\n=== translation_parallel source rows: Ontological_Category (n={len(tp_rows)} source rows) ===")
    for k, v in Counter(r["Ontological_Category"].strip() or "(blank)" for r in tp_rows).most_common():
        emit(f"  {k}: {pct(v, len(tp_rows))}")

    emit(f"\n=== translation_parallel source rows: Semantic_Field (top 15, n={len(tp_rows)} source rows) ===")
    for k, v in Counter(r["Semantic_Field"].strip() or "(blank)" for r in tp_rows).most_common(15):
        emit(f"  {k}: {pct(v, len(tp_rows))}")

    # --- concreteness (Brysbaert 2014), matched onto cueL1_word ---
    emit("\n" + "=" * 60)
    emit("Concreteness (Brysbaert 2014 Conc.M) matched onto cueL1_word")
    emit("=" * 60)

    has_conc = pairs and "cueL1_concreteness" in pairs[0]
    if not has_conc:
        emit("\n  cueL1_concreteness column not found in cue_pairs_preview.csv —")
        emit("  run scripts/add_concreteness_column.py first, then re-run this script.")
    else:
        by_word = {}
        pair_scores = []
        unmatched_pairs = 0
        for p in pairs:
            w = p["cueL1_word"].strip().lower()
            raw = p["cueL1_concreteness"].strip()
            if raw:
                v = float(raw)
                by_word[w] = v
                pair_scores.append(v)
            else:
                unmatched_pairs += 1

        n_unique = len({p["cueL1_word"].strip().lower() for p in pairs})
        emit(f"\nUnique English anchors: {n_unique}")
        emit(f"  matched:   {len(by_word)} ({100*len(by_word)/n_unique:.1f}%)")
        emit(f"  unmatched: {n_unique - len(by_word)} ({100*(n_unique-len(by_word))/n_unique:.1f}%)")
        emit(f"\nTotal cue pairs: {total}")
        emit(f"  pairs with a concreteness score: {len(pair_scores)} ({100*len(pair_scores)/total:.1f}%)")
        emit(f"  pairs unmatched: {unmatched_pairs}")

        s = pd.Series(list(by_word.values()))
        emit(f"\n=== Conc.M distribution over UNIQUE English anchors (1=abstract, 5=concrete) ===")
        emit(f"  n={len(s)} min={s.min():.2f} p25={s.quantile(.25):.2f} median={s.median():.2f} "
             f"p75={s.quantile(.75):.2f} max={s.max():.2f} mean={s.mean():.2f} sd={s.std():.2f}")

        bins = [1, 2, 3, 4, 5.001]
        labels = ["1-2 (abstract)", "2-3", "3-4", "4-5 (concrete)"]
        binned = pd.cut(s, bins=bins, labels=labels, right=False)
        emit("\n=== coarse bins (unique words) ===")
        for label, count in binned.value_counts().reindex(labels).items():
            emit(f"  {label}: {count} ({100*count/len(s):.1f}%)")

        s_pairs = pd.Series(pair_scores)
        emit("\n=== (for reference) Conc.M distribution over cue PAIRS — words reused across languages count once each ===")
        emit(f"  n={len(s_pairs)} min={s_pairs.min():.2f} median={s_pairs.median():.2f} "
             f"max={s_pairs.max():.2f} mean={s_pairs.mean():.2f} sd={s_pairs.std():.2f}")

    out_txt = f"logs/{today}_cue_pairs_stats.txt"
    with open(out_txt, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    print(f"\nwrote {out_txt}", file=sys.stderr)

    if has_conc:
        fig, ax = plt.subplots(figsize=(7, 4.5), facecolor=SURFACE)
        ax.set_facecolor(SURFACE)
        ax.hist(s, bins=20, range=(1, 5), color=BAR_COLOR, edgecolor=SURFACE, linewidth=0.5)
        ax.set_xlabel("Concreteness (Conc.M, 1=abstract → 5=concrete)", color=TEXT_SECONDARY)
        ax.set_ylabel("Number of unique English words", color=TEXT_SECONDARY)
        ax.set_title(f"Concreteness distribution of unique English cue anchors (n={len(s)})", color=TEXT_PRIMARY, loc="left")
        ax.grid(axis="y", color=GRID_COLOR, linewidth=0.8, zorder=0)
        ax.set_axisbelow(True)
        for spine in ["top", "right"]:
            ax.spines[spine].set_visible(False)
        for spine in ["left", "bottom"]:
            ax.spines[spine].set_color(AXIS_COLOR)
        ax.tick_params(colors=TEXT_SECONDARY)
        fig.tight_layout()

        out_png = f"logs/{today}_concreteness_distribution.png"
        fig.savefig(out_png, dpi=150)
        print(f"wrote {out_png}", file=sys.stderr)


if __name__ == "__main__":
    main()
