export const INSTRUCTION_SECTIONS = [
  {
    score: 1.0,
    title: "Direct translation / equivalent concept",
    summary: "The words express the same core meaning at the same level of specificity, have the same part of speech, and are generally interchangeable in context.",
    criteria: [
      "Reserve 1.0 for the closest cross-lingual equivalent.",
      // "If a word is a good translation but not the best available translation, score it no higher than 0.8.",
    ],
  },
  {
    score: 0.8,
    title: "Strong alignment / near-equivalent",
    summary: "The words share the same core meaning but differ slightly in nuance, scope, strength, formality, grammatical form, or one additional sense.",
    details: [
      "Near-synonym: the essential meaning is shared, with a minor difference in nuance or style.",
      "Partial sense match: one word covers the target sense but also has senses the other word lacks.",
      "Intensity or formality: both words express the same quality at slightly different strengths or registers.",
      "Part of speech: the conceptual core is the same, but one item may be a noun and the other a verb or adjective.",
    ],
    criteria: [
      // "Reserve 1.0 for the closest cross-lingual equivalent.",
      "If a word is a good translation but not the best available translation, score it no higher than 0.8.",
    ],
    
  },
  {
    score: 0.5,
    title: "Moderate alignment",
    summary: "The words refer to substantially overlapping concepts, but one is notably broader, narrower, a type of the other, or a part of the other.",
    details: [
      "Hyponym/hypernym: one word is a kind of the other, such as surgeon and doctor.",
      "Broader/narrower specificity: the meanings overlap, but at substantially different levels of specificity.",
      "Part–whole: one word names a constituent part of the other.",
      "Shared semantic or material core: the concepts overlap in a defining component, but neither is a near-equivalent.",
    ],
    criteria: [
      "Be strict with 0.5. If a relationship is not one of the defined moderate-alignment relations, use 0.",
    ],
  },
  {
    score: 0.0,
    title: "No alignment",
    summary: "The words do not refer to the same concept in the context established by the cue pair.",
    details: [
      "Score thematic or environmental relationships 0, even when the words commonly occur together.",
      "Score co-hyponyms 0: sibling concepts such as breakfast and dinner are related, but not equivalent.",
      "Score possible causal relationships 0, such as rain and wet.",
      "Score shared functional roles 0: being two colours of a taxi does not make the colour words equivalent.",
      "Score event–participant or action–object relationships 0, such as taking a cab and cab.",
    ],
    criteria: [
      "A shared relational role or broad semantic domain is not enough for a non-zero score.",
    ],
  },
];

export const SCORING_DISCIPLINE = [
  "Use 1.0 and 0.8 sparingly. Within a synonym cluster, mark only the one or two closest matches.",
  // "Be strict with 0.5. If a relationship is not one of the defined moderate-alignment relations, use 0.",
  "Opposite polarity does not create alignment unless the two words are themselves translations.",
  // "A generic match does not make every instance of that generic concept a match.",
  "Blank cells are saved as 0, so only mark cells with a real conceptual alignment.",
];

export const PRACTICE_EXAMPLES = [
  {
    id: "doctor",
    label: "Practice 1 · Concrete concept",
    cueL1: { w: "大夫", lang: "Mandarin Chinese" },
    cueL2: { w: "doctor", lang: "English" },
    context: "The cue pair establishes the concept of a medical doctor. Complete the matrix exactly as you will in the real task.",
    cols: ["doctor", "physician", "coat"],
    rows: [
      { w: "大夫", gloss: "doctor (cue)" },
      { w: "医生", gloss: "doctor / physician" },
      { w: "白大褂", gloss: "white coat" },
    ],
    answers: [
      [1.0, 0.8, 0.0],
      [1.0, 0.8, 0.0],
      [0.0, 0.0, 0.5],
    ],
    explanations: {
      "0|0": "大夫 and doctor are direct translations in this cue context.",
      "0|1": "大夫 and physician can often be used interchangeably because both refer to a medical doctor. However, physician is a narrower, more formal term that normally denotes a licensed medical practitioner, while 大夫 is a more general term for doctor. This makes them strongly aligned rather than fully equivalent.",
      "0|2": "大夫 refers to a person, while coat refers to clothing. They may occur together in a medical setting, but shared context is not conceptual equivalence.",
      "1|0": "医生 and doctor are direct translations.",
      "1|1": "医生 and physician can often be used interchangeably because both refer to a medical doctor. However, physician is narrower and normally denotes a licensed medical practitioner, while 医生 is the more general term for doctor. This difference in scope makes the pair 0.8 rather than 1.0.",
      "1|2": "医生 refers to a medical professional, while coat is an item of clothing. An association through medical clothing must be scored 0.",
      "2|0": "白大褂 is a white coat, not a doctor. A doctor may wear one, but an object–wearer relationship is thematic rather than equivalent.",
      "2|1": "白大褂 names clothing and physician names a person. Their shared medical setting does not make their meanings align.",
      "2|2": "白大褂 literally denotes a white coat, while coat is broader, giving a moderate broader/narrower match.",
    },
  },
  {
    id: "happy",
    label: "Practice 2 · Abstract concept",
    cueL1: { w: "快乐", lang: "Mandarin Chinese" },
    cueL2: { w: "happy", lang: "English" },
    context: "Abstract emotion words often overlap without being fully interchangeable. Attend to nuance, intensity, and scope.",
    cols: ["happy", "glad", "joy"],
    rows: [
      { w: "快乐", gloss: "happy (cue)" },
      { w: "高兴", gloss: "glad / pleased" },
      { w: "愉悦", gloss: "joy / pleasure" },
    ],
    answers: [
      [1.0, 0.0, 0.5],
      [0.8, 1.0, 0.5],
      [0.5, 0.0, 1.0],
    ],
    explanations: {
      "0|0": "快乐 and happy are the closest direct equivalents in this cue pair.",
      "0|1": "快乐 and glad are related positive states, but 高兴 is the closer match for glad in this matrix. Under the sparsity rule, the weaker competing match is scored 0.",
      "0|2": "快乐 and joy share positive affect, but differ in grammatical form and scope.",
      "1|0": "高兴 and happy are near-equivalents with a minor nuance difference.",
      "1|1": "高兴 and glad are the closest direct equivalents in this association set.",
      "1|2": "高兴 and joy share positive affect, but differ substantially in grammatical form and scope.",
      "2|0": "愉悦 and happy overlap in positive affect, but one names joy or pleasure while the other describes a broader state.",
      "2|1": "愉悦 and glad belong to the same positive-emotion domain, but they are not the closest equivalents and differ in grammatical form and meaning scope.",
      "2|2": "愉悦 and joy name the same core abstract concept.",
    },
  },
];

export const TEST_EXAMPLE = {
  id: "mist_cloud_test",
  cueL1: { w: "mist", lang: "Dutch" },
  cueL2: { w: "cloud", lang: "English" },
  cols: ["cloud", "fog", "sky", "rain"],
  rows: [
    { w: "mist", gloss: "" },
    { w: "nevel", gloss: "" },
  ],
  answers: [
    [0.5, 1.0, 0.0, 0.0],
    [0.5, 0.8, 0.0, 0.0],
  ],
};

const DUTCH_PRACTICE_EXAMPLES = [
  {
    id: "dak_ceiling",
    label: "Practice 1 · Concrete concept",
    cueL1: { w: "dak", lang: "Dutch" },
    cueL2: { w: "ceiling", lang: "English" },
    context: "Distinguish direct translations from broader, narrower, and part–whole relationships.",
    cols: ["ceiling", "roof", "tile"],
    rows: [
      { w: "dak", gloss: "roof (cue)" },
      { w: "pannen", gloss: "roof tiles" },
      { w: "pan", gloss: "tile" },
    ],
    answers: [[0.5, 1.0, 0.0], [0.0, 0.5, 0.8], [0.0, 0.0, 1.0]],
    explanations: {
      "0|0": "Dak means roof, while ceiling is the interior overhead surface; they are related parts of a building but not equivalent.",
      "0|1": "Dak and roof are direct translations.",
      "0|2": "A roof may contain tiles, but the whole object is not equivalent to one of its materials.",
      "1|0": "Roof tiles and a ceiling are different building components.",
      "1|1": "Pannen names the tiles that form part of a roof, so this is a part–whole relationship.",
      "1|2": "Pannen and tile share the same core concept, but the Dutch plural and roofing-specific use make the match slightly narrower.",
      "2|0": "Pan and ceiling refer to different building components.",
      "2|1": "A tile can be part of a roof, but part–whole context alone does not make these words equivalent here.",
      "2|2": "Pan and tile are direct equivalents in this association context.",
    },
  },
  {
    id: "vrolijk_happy",
    label: "Practice 2 · Abstract concept",
    cueL1: { w: "vrolijk", lang: "Dutch" },
    cueL2: { w: "happy", lang: "English" },
    context: "Emotion words often overlap in meaning while differing in nuance and strength.",
    cols: ["happy", "glad", "fun"],
    rows: [
      { w: "vrolijk", gloss: "cheerful / happy (cue)" },
      { w: "blij", gloss: "happy / glad" },
      { w: "leuk", gloss: "fun / nice" },
    ],
    answers: [[0.8, 0.5, 0.0], [1.0, 0.8, 0.0], [0.0, 0.0, 1.0]],
    explanations: {
      "0|0": "Vrolijk and happy strongly overlap, but vrolijk is closer to cheerful and carries a livelier nuance.",
      "0|1": "Vrolijk and glad share positive affect, but differ noticeably in nuance and scope.",
      "0|2": "Being cheerful and something being fun may co-occur, but they are not the same concept.",
      "1|0": "Blij and happy are the closest direct equivalents.",
      "1|1": "Blij and glad are near-equivalents with a small nuance difference.",
      "1|2": "Blij describes a person's emotion; fun describes an enjoyable experience.",
      "2|0": "Leuk describes something pleasant or fun, not the emotional state happy.",
      "2|1": "Leuk and glad belong to a positive domain but are not equivalent.",
      "2|2": "Leuk and fun are direct equivalents in this context.",
    },
  },
];

const GERMAN_PRACTICE_EXAMPLES = [
  {
    id: "mediziner_doctor",
    label: "Practice 1 · Concrete concept",
    cueL1: { w: "Mediziner", lang: "German" },
    cueL2: { w: "doctor", lang: "English" },
    context: "Pay attention to register, professional scope, and shared medical context.",
    cols: ["doctor", "physician", "coat"],
    rows: [
      { w: "Mediziner", gloss: "medical practitioner (cue)" },
      { w: "Arzt", gloss: "doctor" },
      { w: "Kittel", gloss: "coat / smock" },
    ],
    answers: [[0.8, 0.8, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 0.8]],
    explanations: {
      "0|0": "Mediziner and doctor strongly overlap, but Mediziner is a more formal occupational term.",
      "0|1": "Mediziner and physician are strong near-equivalents with differences in conventional scope and usage.",
      "0|2": "A medical practitioner may wear a coat, but person and clothing are not equivalent.",
      "1|0": "Arzt and doctor are direct translations.",
      "1|1": "In this labelled set, physician is not the closest association match for Arzt; reserve the strongest score for doctor.",
      "1|2": "Arzt names a person, while coat names clothing.",
      "2|0": "Kittel is clothing and doctor is a person; their medical context does not create equivalence.",
      "2|1": "Kittel and physician are thematically related through medicine but mean different things.",
      "2|2": "Kittel and coat share the same core clothing concept, with a register and garment-type nuance.",
    },
  },
  {
    id: "froehlich_happy",
    label: "Practice 2 · Abstract concept",
    cueL1: { w: "fröhlich", lang: "German" },
    cueL2: { w: "happy", lang: "English" },
    context: "Emotion words require careful judgments of nuance, strength, and closest-match sparsity.",
    cols: ["happy", "glad", "fun"],
    rows: [
      { w: "fröhlich", gloss: "cheerful / happy (cue)" },
      { w: "glücklich", gloss: "happy / fortunate" },
      { w: "Spaß", gloss: "fun" },
    ],
    answers: [[0.8, 0.5, 0.0], [0.8, 0.5, 0.0], [0.0, 0.0, 1.0]],
    explanations: {
      "0|0": "Fröhlich and happy strongly overlap, but fröhlich is closer to cheerful in nuance.",
      "0|1": "Fröhlich and glad share positive affect but differ in scope and conventional use.",
      "0|2": "A cheerful person may have fun, but an emotion and an enjoyable activity are not equivalent.",
      "1|0": "Glücklich and happy are strong near-equivalents; glücklich can also mean fortunate.",
      "1|1": "Glücklich and glad overlap moderately but are not interchangeable across their full senses.",
      "1|2": "Glücklich describes a state, while fun describes an experience or quality.",
      "2|0": "Spaß and happy belong to a positive domain but do not denote the same concept.",
      "2|1": "Spaß and glad are contextually related but not equivalent.",
      "2|2": "Spaß and fun are direct translations.",
    },
  },
];

export const PRACTICE_EXAMPLES_BY_LANGUAGE = {
  zh: PRACTICE_EXAMPLES,
  nl: DUTCH_PRACTICE_EXAMPLES,
  de: GERMAN_PRACTICE_EXAMPLES,
};

export const TEST_EXAMPLES_BY_LANGUAGE = {
  nl: TEST_EXAMPLE,
  zh: {
    id: "wu_cloud_test",
    cueL1: { w: "雾", lang: "Mandarin Chinese" },
    cueL2: { w: "cloud", lang: "English" },
    cols: ["fog", "cloud", "sky"],
    rows: [
      { w: "雾", gloss: "" },
      { w: "雾气", gloss: "" },
      { w: "雾霾", gloss: "" },
    ],
    answers: [[1.0, 0.0, 0.0], [0.8, 0.0, 0.0], [0.5, 0.0, 0.0]],
  },
  de: {
    id: "nebel_cloud_test",
    cueL1: { w: "Nebel", lang: "German" },
    cueL2: { w: "cloud", lang: "English" },
    cols: ["fog", "rain", "water", "sky"],
    rows: [
      { w: "Nebel", gloss: "fog (cue)" },
      { w: "Dunst", gloss: "mist / haze" },
      { w: "Regen", gloss: "rain" },
    ],
    answers: [[1.0, 0.0, 0.0, 0.0], [0.8, 0.0, 0.0, 0.0], [0.0, 1.0, 0.5, 0.0]],
  },
};
