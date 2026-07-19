/* ------------------------------------------------------------------ *
 * Task data. Each entry is one cue-pair matrix the worker will score,
 * shown in sequence. Generate this array from your .flow_matrices.npz
 * pipeline (see scripts/npz_to_taskdata.py) and paste/import it here.
 *
 * gold: cells with a known correct score, used for the attention check.
 *   Keep these invisible to workers. At least one non-zero gold per
 *   session is recommended so all-blank submissions get flagged.
 * ------------------------------------------------------------------ */

export const CUE_PAIRS = [
  {
    id: "chuzuche_taxi",
    cueL1: { w: "出租车", lang: "zh" },
    cueL2: { w: "taxi", lang: "en" },
    cols: ["taxi", "cab", "yellow", "driver", "car", "fare", "hail", "ride", "drive", "black", "expensive", "money"],
    rows: [
      { w: "出租车", gloss: "taxi (the cue)" },
      { w: "司机", gloss: "driver" },
      { w: "滴滴", gloss: "ride-hail app (brand)" },
      { w: "打的", gloss: "to hail a cab (verb)" },
      { w: "的士", gloss: "taxi (informal)" },
      { w: "乘客", gloss: "passenger" },
      { w: "贵", gloss: "expensive" },
      { w: "黑车", gloss: "unlicensed cab" },
      { w: "绿色", gloss: "green (colour)" },
    ],
    // gold: [{rowWord, colWord, expect}] — hidden checks
    gold: [
      { rowWord: "的士", colWord: "taxi", expect: 1.0 },   // clean equivalent
      { rowWord: "司机", colWord: "driver", expect: 1.0 }, // second non-zero gold
    ],
  },
  // … append more cue-pair matrices here …
];

export const OFFLINE_CUE_PAIRS_BY_LANGUAGE = {
  zh: CUE_PAIRS,
  nl: [
    {
      id: "accident_nl1_ongeluk_demo",
      cueL1: { w: "accident", lang: "en" },
      cueL2: { w: "ongeluk", lang: "nl" },
      cols: ["ongeluk", "auto", "pech", "dood", "ongeval", "pijn"],
      rows: [
        { w: "accident", gloss: "" },
        { w: "car", gloss: "" },
        { w: "crash", gloss: "" },
        { w: "mistake", gloss: "" },
        { w: "injury", gloss: "" },
        { w: "oops", gloss: "" },
      ],
      gold: [],
    },
  ],
  de: [
    {
      id: "accident_de1_unfall_demo",
      cueL1: { w: "accident", lang: "en" },
      cueL2: { w: "Unfall", lang: "de" },
      cols: ["Unfall", "Auto", "Polizei", "Krankenhaus", "Blut", "Verletzte"],
      rows: [
        { w: "accident", gloss: "" },
        { w: "car", gloss: "" },
        { w: "crash", gloss: "" },
        { w: "mistake", gloss: "" },
        { w: "injury", gloss: "" },
        { w: "oops", gloss: "" },
      ],
      gold: [],
    },
  ],
};

// Quality-control thresholds.
export const QC = {
  // Minimum active seconds per matrix; below this = likely straight-lining.
  minSecondsPerMatrix: 8,
  // How many gold cells a worker may miss before the session is flagged.
  maxGoldMisses: 0,
};

// The four bands. Single source of truth for legend, buttons, and fills.
export const BANDS = [
  { v: 1.0, key: "1", label: "Equivalent", blurb: "Direct translation, equivalent concept.", c: "#1f6f5c", ink: "#fff" },
  { v: 0.8, key: "2", label: " Strong alignment", blurb: "Same core meaning; minor differences in level, scope, strength, formality, or POS.", c: "#5a9e6f", ink: "#fff" },
  { v: 0.5, key: "3", label: "Moderate alignment", blurb: "Typically refer to the same event, object,and concept.", c: "#d9a23b", ink: "#3a2a00" },
  { v: 0.0, key: "4", label: "None", blurb: "No substitution context. Thematic relationship. (Default for blanks.)", c: "#c4c8cf", ink: "#26292e" },
];
