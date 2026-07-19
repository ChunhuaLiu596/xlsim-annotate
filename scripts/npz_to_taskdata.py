#!/usr/bin/env python3
"""
Convert .flow_matrices.npz cue pairs into the CUE_PAIRS array for
src/taskData.js.

The .npz stores, per cue pair, keys like:
    "<cue1>__<cue2>__wasserstein_F"     -> flow matrix
    "<cue1>__<cue2>__response_1"        -> row (L1) words, cue first
    "<cue1>__<cue2>__response_2"        -> col (L2) words, cue first

We emit one entry per cue pair with rows = response_1, cols = response_2.
Glosses are left blank ("") — fill them from your bilingual dictionary or
Gemini labeling pass if you want them shown to annotators.

Usage:
    python npz_to_taskdata.py CMN-ENG.flow_matrices.npz > cue_pairs.json
Then paste the JSON array into src/taskData.js as CUE_PAIRS
(or import it directly).
"""
import sys, json, re
import numpy as np


def iter_pairs(data):
    for key in data.files:
        if not key.endswith("__wasserstein_F") and not key.endswith("__optimal_assignment_F"):
            continue
        suffix = "__wasserstein_F" if key.endswith("__wasserstein_F") else "__optimal_assignment_F"
        prefix = key[: -len(suffix)]
        res1 = [str(x) for x in data[f"{prefix}__response_1"]]
        res2 = [str(x) for x in data[f"{prefix}__response_2"]]
        cue1, cue2 = prefix.split("__")[:2]
        yield cue1, cue2, res1, res2


def slug(s):
    return re.sub(r"[^a-zA-Z0-9]+", "_", s).strip("_").lower()


def main(path):
    data = np.load(path, allow_pickle=True)
    out = []
    for cue1, cue2, res1, res2 in iter_pairs(data):
        out.append({
            "id": f"{slug(cue1)}_{slug(cue2)}",
            "cueL1": {"w": cue1, "lang": "zh"},
            "cueL2": {"w": cue2, "lang": "en"},
            "cols": res2,                                  # L2 associations, cue first
            "rows": [{"w": w, "gloss": ""} for w in res1], # L1 associations, cue first
            "gold": [],                                    # add hidden checks per pair
        })
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python npz_to_taskdata.py <file.flow_matrices.npz>")
    main(sys.argv[1])
