import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { CUE_PAIRS as DEMO_CUE_PAIRS, OFFLINE_CUE_PAIRS_BY_LANGUAGE, QC, BANDS } from "./taskData.js";
import {
  INSTRUCTION_SECTIONS, SCORING_DISCIPLINE,
  PRACTICE_EXAMPLES_BY_LANGUAGE, TEST_EXAMPLES_BY_LANGUAGE,
} from "./instructions.js";
import { backendReady } from "./supabase.js";
import {
  getProlificParams, fetchAssignedPairs, startSession, saveCells,
  finishSession, redirectToProlific, saveDemographics, saveFeedback, COMPLETION_CODE, COMPLETION_URL,
} from "./prolific.js";

const bandOf = (v) => BANDS.find((b) => b.v === v);
const FONT_CJK = `"Noto Sans CJK SC","Noto Sans SC","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif`;
const LANGUAGE_NAMES = {
  zh: "Mandarin Chinese",
  cmn: "Mandarin Chinese",
  en: "English",
  nl: "Dutch",
  de: "German",
  es: "Spanish",
};
const languageName = (language, fallback) => LANGUAGE_NAMES[language] || language || fallback;

// Rough px-per-character estimate (CJK glyphs render roughly 2x as wide as Latin ones at this font size).
const textWidthPx = (text = "") => {
  let w = 0;
  for (const ch of text) w += /[　-鿿＀-￯]/.test(ch) ? 15 : 8;
  return w;
};
const LABEL_COL_MIN = 120;
const LABEL_COL_MAX = 200;
// Widest row label in the sticky label column, clamped.
const labelColWidth = (rows) => {
  const widest = Math.max(...rows.map((r) => textWidthPx(r.w)), 0);
  return Math.min(LABEL_COL_MAX, Math.max(LABEL_COL_MIN, widest + 40));
};

// Dev-only jump targets, in flow order. `page` is only used when stage === "intro".
const NAV_STAGES = [
  { label: "Overview & consent", stage: "intro", page: 1 },
  { label: "Language pair", stage: "intro", page: "language" },
  { label: "Demographics", stage: "intro", page: 2 },
  { label: "Instructions", stage: "intro", page: 3 },
  { label: "Practice", stage: "intro", page: 4 },
  { label: "Qualification test", stage: "intro", page: 5 },
  { label: "Main task", stage: "task" },
  { label: "Feedback", stage: "feedback" },
  { label: "Done", stage: "done" },
];

function DevNav({ current, onJump }) {
  return (
    <div style={st.devNav}>
      <div style={st.devNavLabel}>Dev nav</div>
      {NAV_STAGES.map((entry) => {
        const active = entry.stage === current.stage && (entry.stage !== "intro" || entry.page === current.page);
        return (
          <button
            key={entry.label}
            onClick={() => onJump(entry)}
            style={{ ...st.devNavBtn, ...(active ? st.devNavBtnActive : {}) }}
          >
            {entry.label}
          </button>
        );
      })}
    </div>
  );
}

function CuePairHeading({ cueL1, cueL2 }) {
  const leftLanguage = languageName(cueL1.lang, "Language 1");
  const rightLanguage = languageName(cueL2.lang, "English");
  return (
    <>
      <h1 style={st.cuePairTitle}>
        <span>
          <span style={st.cuePairWord}>{cueL1.w}</span>
          <span style={st.cuePairLanguage}>{leftLanguage}</span>
        </span>
        <span style={st.cuePairArrow}>↔</span>
        <span>
          <span style={st.cuePairWord}>{cueL2.w}</span>
          <span style={st.cuePairLanguage}>{rightLanguage}</span>
        </span>
      </h1>
      <AxisCueCaption cueL1={cueL1} cueL2={cueL2} />
    </>
  );
}

// Row axis = cueL1's language, column axis = cueL2's language — spells out which cue word anchors each axis
// instead of cramming "cueL1 ↔ cueL2" into the table's corner cell, which squeezed data columns on long cue pairs.
function AxisCueCaption({ cueL1, cueL2 }) {
  const leftLanguage = languageName(cueL1.lang, "Language 1");
  const rightLanguage = languageName(cueL2.lang, "English");
  return (
    <div style={st.axisStatement}>
      Rows ({leftLanguage}) cue: <b style={{ fontFamily: FONT_CJK }}>{cueL1.w}</b>
      <span style={{ margin: "0 10px", color: "#c9c4b6" }}>·</span>
      Columns ({rightLanguage}) cue: <b>{cueL2.w}</b>
    </div>
  );
}

function InstructionLists({ section, large = false }) {
  const listStyle = large
    ? { ...st.lead, fontSize: 13.5, margin: 0, paddingLeft: 18 }
    : { margin: 0, paddingLeft: 18, lineHeight: 1.5 };
  return (
    <>
      {section.details?.length > 0 && (
        <div style={{ marginBottom: section.criteria?.length ? 10 : 0 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#6b727c", marginBottom: 4 }}>Example relationships</div>
          <ul style={listStyle}>
            {section.details.map((item) => <li key={item} style={{ marginBottom: 4 }}>{item}</li>)}
          </ul>
        </div>
      )}
      {section.criteria?.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#6b727c", marginBottom: 4 }}>Annotation criteria</div>
          <ul style={listStyle}>
            {section.criteria.map((item) => <li key={item} style={{ marginBottom: 4 }}>{item}</li>)}
          </ul>
        </div>
      )}
    </>
  );
}

export default function App() {
  const [stage, setStage] = useState("intro"); // loading | intro | task | done
  const [introStartPage, setIntroStartPage] = useState(1);
  const [introKey, setIntroKey] = useState(0);
  const [selectedLanguage, setSelectedLanguage] = useState("");
  const [cuePairs, setCuePairs] = useState(null); // this participant's assigned matrices
  const [loadErr, setLoadErr] = useState(null);
  const [pair, setPair] = useState(0);            // index into cuePairs
  const [scores, setScores] = useState({});       // "pair|r|c" -> v (explicit)
  const [activeRow, setActiveRow] = useState(0);
  const [col, setCol] = useState(0);
  const [hoverCol, setHoverCol] = useState(null);
  const [showMatrixOverview, setShowMatrixOverview] = useState(false);
  const [prolific] = useState(getProlificParams);
  const [t0] = useState(Date.now());
  const [matrixEnter, setMatrixEnter] = useState(Date.now());
  const [saveErr, setSaveErr] = useState(null);
  const liveRef = useRef(null);
  const activeRef = useRef(null);

  useLayoutEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [stage]);

  // ---- fetch this participant's assignment (or fall back to demo data offline) ----
  useEffect(() => {
    if (!selectedLanguage) return undefined;
    let cancelled = false;
    (async () => {
      if (!backendReady) {
        setCuePairs(OFFLINE_CUE_PAIRS_BY_LANGUAGE[selectedLanguage] || DEMO_CUE_PAIRS);
        return;
      }
      const res = await fetchAssignedPairs(prolific.pid, 5, selectedLanguage);
      if (cancelled) return;
      if (!res.ok || res.pairs.length === 0) {
        setLoadErr(res.error?.message || "no cue pairs available");
        setCuePairs(DEMO_CUE_PAIRS); // still let them proceed rather than hard-block
      } else {
        setCuePairs(res.pairs);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLanguage]);

  const CUE_PAIRS = (cuePairs || []).filter((candidate) =>
    candidate.cueL1?.lang === selectedLanguage || candidate.cueL2?.lang === selectedLanguage
  );
  const task = CUE_PAIRS[pair];
  const R = task ? task.rows.length : 0, C = task ? task.cols.length : 0;
  const key = (r, c) => `${pair}|${r}|${c}`;
  const explicit = (r, c) => scores[key(r, c)];

  // ---- session bootstrap ----
  useEffect(() => {
    if (stage !== "task") return;
    startSession(prolific);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  useEffect(() => { activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [activeRow, pair]);

  const setCell = useCallback((c, v) => {
    setScores((s) => ({ ...s, [key(activeRow, c)]: v }));
    if (liveRef.current) liveRef.current.textContent =
      `${task.rows[activeRow].w} × ${task.cols[c]} = ${v.toFixed(1)} ${bandOf(v).label}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRow, C, pair]);

  // commit a row: fill blanks with 0, persist the whole row to backend
  const commitRow = async (r) => {
    const rowCells = [];
    const nextScores = { ...scores };
    for (let c = 0; c < C; c++) {
      const k = key(r, c);
      if (nextScores[k] === undefined) nextScores[k] = 0.0;
      rowCells.push({
        pid: prolific.pid, cueId: task.id,
        rowWord: task.rows[r].w, colWord: task.cols[c], score: nextScores[k],
      });
    }
    setScores(nextScores);
    const res = await saveCells(rowCells);
    if (!res.ok) setSaveErr(res.error?.message || "save failed");
  };

  const advance = async () => {
    if (col + 1 < C) { setCol(col + 1); return; }
    await commitRow(activeRow);
    if (activeRow + 1 < R) { setActiveRow(activeRow + 1); setCol(0); return; }
    // matrix finished → next pair, or done
    if (pair + 1 < CUE_PAIRS.length) {
      setPair(pair + 1); setActiveRow(0); setCol(0); setMatrixEnter(Date.now());
    } else {
      await finalize();
    }
  };

  const previousCell = () => {
    if (col > 0) { setCol(col - 1); return; }
    if (activeRow > 0) { setActiveRow(activeRow - 1); setCol(C - 1); }
  };

  // ---- gold QC over everything scored so far ----
  const computeGold = (allScores) => {
    let misses = 0, total = 0;
    CUE_PAIRS.forEach((cp, pi) => {
      (cp.gold || []).forEach((g) => {
        const ri = cp.rows.findIndex((x) => x.w === g.rowWord);
        const ci = cp.cols.indexOf(g.colWord);
        if (ri < 0 || ci < 0) return;
        total++;
        const got = allScores[`${pi}|${ri}|${ci}`] ?? 0;
        if (got !== g.expect) misses++;
      });
    });
    return { misses, total, pass: misses <= QC.maxGoldMisses };
  };

  const finalize = async () => {
    setStage("feedback");
  };

  const submitFeedback = async (answers) => {
    await saveFeedback({ pid: prolific.pid, answers });
    const gold = computeGold(scores);
    const activeMs = Date.now() - t0;
    const res = await finishSession({ pid: prolific.pid, goldPass: gold.pass, activeMs });
    if (!res.ok) { setSaveErr(res.error?.message || "finish save failed"); return; }
    setStage("done");
    // save-before-redirect: only now do we send them back to Prolific
    if (COMPLETION_URL) setTimeout(redirectToProlific, 1200);
  };

  // ---- dev-only stage navigation (never shown once a backend is configured) ----
  const jumpTo = (entry) => {
    if (entry.stage === "intro") {
      setIntroStartPage(entry.page);
      setIntroKey((k) => k + 1);
    }
    setStage(entry.stage);
  };
  const devNavEnabled = !backendReady || new URLSearchParams(window.location.search).get("dev") === "1";
  const devNav = devNavEnabled
    ? <DevNav current={{ stage, page: introStartPage }} onJump={jumpTo} />
    : null;

  // ---- keyboard ----
  useEffect(() => {
    if (stage !== "task") return;
    const h = (e) => {
      const b = BANDS.find((x) => x.key === e.key);
      if (b) { e.preventDefault(); setCell(col, b.v); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); setCol((c) => Math.min(c + 1, C - 1)); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setCol((c) => Math.max(c - 1, 0)); }
      else if (e.key === "Enter") { e.preventDefault(); advance(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, col, activeRow, pair, setCell, C]);

  if (stage === "loading") {
    return (
      <>
        {devNav}
        <Shell>
          <div style={{ maxWidth: 560, margin: "20vh auto", textAlign: "center", color: "#8a8578" }}>
            Loading your assignment…
          </div>
        </Shell>
      </>
    );
  }

  if (stage === "intro") {
    return (
      <>
        {devNav}
        <Intro
          key={introKey}
          initialPage={introStartPage}
          pid={prolific.pid}
          selectedLanguage={selectedLanguage}
          onLanguageChange={setSelectedLanguage}
          onStart={() => { setStage("task"); setMatrixEnter(Date.now()); }}
        />
      </>
    );
  }

  if (stage === "feedback") {
    return (
      <>
        {devNav}
        <Feedback onSubmit={submitFeedback} />
      </>
    );
  }

  if (stage === "done") {
    return (
      <>
        {devNav}
        <Shell>
          <div style={{ maxWidth: 560, margin: "12vh auto", textAlign: "center" }}>
            <div style={st.kicker}>Submission</div>
            <h1 style={st.h1}>Thank you — all done</h1>
            <p style={{ fontSize: 15, color: "#5b636e", lineHeight: 1.6 }}>
              {CUE_PAIRS.length} matrices scored in {Math.round((Date.now() - t0) / 1000)}s.
            </p>
            {COMPLETION_URL
              ? <p style={{ fontSize: 14, color: "#8a8578" }}>Redirecting you back to Prolific…</p>
              : COMPLETION_CODE
                ? <div style={st.codeBox}>Your completion code: <b>{COMPLETION_CODE}</b><br /><span style={{ fontSize: 13, color: "#6b727c" }}>Paste this into Prolific to register your submission.</span></div>
                : <p style={{ fontSize: 13, color: "#b9532f" }}>No completion code configured (set VITE_PROLIFIC_COMPLETION_URL or _CODE).</p>}
            {saveErr && <p style={{ color: "#b9532f", fontSize: 13 }}>Note: a save error occurred ({saveErr}). Your data may be incomplete.</p>}
          </div>
        </Shell>
      </>
    );
  }

  if (!task) {
    return (
      <>
        {devNav}
        <Shell>
          <div style={{ maxWidth: 620, margin: "16vh auto", textAlign: "center" }}>
            <h1 style={st.h1}>No matching annotation matrices loaded</h1>
            <p style={st.lead}>
              No English–{languageName(selectedLanguage, selectedLanguage)} cue pairs are available in this environment.
            </p>
            <button style={st.secondary} onClick={() => { setIntroStartPage(1); setStage("intro"); }}>
              ← Choose another language pair
            </button>
          </div>
        </Shell>
      </>
    );
  }

  const cellNumber = activeRow * C + col + 1;
  const totalCells = R * C;
  const pctPair = Math.round(((cellNumber - 1) / totalCells) * 100);
  const labelWidth = labelColWidth(task.rows);
  const currentValue = explicit(activeRow, col);
  const isCueCueCell = activeRow === 0 && col === 0;

  return (
    <>
      {devNav}
      <Shell wide>
      <div ref={liveRef} aria-live="polite" style={st.sr} />

      {!backendReady && <div style={st.warn}>⚠ Backend not configured — running in preview mode, nothing is being saved. Set Supabase env vars before launching.</div>}
      {!prolific.pid && backendReady && <div style={st.warn}>⚠ No PROLIFIC_PID in the URL — data will be keyed to an empty ID. This is expected only in local testing.</div>}
      {loadErr && <div style={st.warn}>⚠ Could not load your assignment from the server ({loadErr}) — showing demo data instead. Your work will not be saved correctly.</div>}

      <header style={st.pairTopBar}>
        <span style={st.pairMatrixCount}>Matrix {pair + 1} of {CUE_PAIRS.length}</span>
        <div style={st.pairCellProgress}>
          <span>Cell {cellNumber} of {totalCells}</span>
          <div style={st.taskProgressTrack}><div style={{ ...st.taskProgressFill, width: `${pctPair}%` }} /></div>
        </div>
        <details style={st.taskGuide}>
          <summary style={st.pairGuideSummary}>▣&nbsp; Scoring guide</summary>
          <div style={st.taskGuideBody}>
          {INSTRUCTION_SECTIONS.map((section) => {
            const band = bandOf(section.score);
            return (
              <div key={section.score} style={{ ...st.referenceRow, marginBottom: 12 }}>
                <span style={{ ...st.referenceScore, background: band.c, color: band.ink }}>
                  {section.score.toFixed(1)}
                </span>
                <div>
                  <div><b>{section.title}</b></div>
                  <p style={{ margin: "3px 0 6px", lineHeight: 1.5 }}>{section.summary}</p>
                  <InstructionLists section={section} />
                </div>
              </div>
            );
          })}
          <div style={{ fontWeight: 800, margin: "8px 0 5px" }}>Scoring discipline</div>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5 }}>
            {SCORING_DISCIPLINE.map((rule) => <li key={rule} style={{ marginBottom: 4 }}>{rule}</li>)}
          </ul>
          </div>
        </details>
      </header>

      <main style={st.pairPage}>
        <div style={st.pairCueLabel}>Cue words</div>
        <div style={st.pairCuePair}>
          <div><b style={{ ...st.pairCueWord, fontFamily: FONT_CJK }}>{task.cueL1.w}</b><span style={st.pairLanguage}>{languageName(task.cueL1.lang, "Language 1")}</span></div>
          <span style={st.pairArrow}>↔</span>
          <div><b style={st.pairCueWord}>{task.cueL2.w}</b><span style={st.pairLanguage}>{languageName(task.cueL2.lang, "English")}</span></div>
        </div>
        <button type="button" style={st.pairOverviewLink} onClick={() => setShowMatrixOverview(true)}>Open matrix overview</button>

        <section style={st.pairQuestionCard}>
          <h1 style={st.pairQuestionTitle}>{isCueCueCell ? "How equivalent are these cue words?" : "How equivalent are these associations?"}</h1>
          <div style={st.pairAssociationGrid}>
            <div style={st.pairAssociationCard}>
              <span style={st.pairAssociationLanguage}>{languageName(task.cueL1.lang, "Language 1")} {isCueCueCell ? "cue word" : "association"}</span>
              <b style={{ ...st.pairAssociationWord, fontFamily: FONT_CJK }}>{task.rows[activeRow].w}</b>
            </div>
            <span style={st.pairAssociationArrow}>↔</span>
            <div style={st.pairAssociationCard}>
              <span style={st.pairAssociationLanguage}>{languageName(task.cueL2.lang, "English")} {isCueCueCell ? "cue word" : "association"}</span>
              <b style={st.pairAssociationWord}>{task.cols[col]}</b>
            </div>
          </div>
          <p style={st.pairQuestionHint}>{isCueCueCell ? "These cue words anchor the matrix. Could one replace the other in context while keeping the meaning?" : "Could one replace the other in context while keeping the meaning?"}</p>
        </section>

        <div style={st.pairKeyHint}>Choose a score or press a keyboard key: <kbd style={st.pairKbd}>1</kbd><kbd style={st.pairKbd}>2</kbd><kbd style={st.pairKbd}>3</kbd><kbd style={st.pairKbd}>4</kbd></div>
        <div style={st.pairScoreList}>
          {BANDS.map((b) => {
            const selected = currentValue === b.v;
            const accent = b.v === 1.0 ? "#176b58" : b.v === 0.8 ? "#3f754c" : b.v === 0.5 ? "#ad6d00" : "#4b515a";
            return (
              <button
                key={b.v}
                type="button"
                onClick={() => setCell(col, b.v)}
                style={{ ...st.pairScoreOption, borderColor: b.c, ...(selected ? { background: b.c, boxShadow: `inset 0 0 0 1px ${b.ink}` } : {}) }}
              >
                <span style={st.pairPress}>Press <b style={{ ...st.pairPressKey, color: accent }}>{b.key}</b></span>
                <strong style={{ ...st.pairScoreNumber, color: accent }}>{b.v.toFixed(1)}</strong>
                <strong style={{ ...st.pairScoreName, color: accent }}>{b.label}</strong>
                <span style={st.pairScoreDescription}>{b.blurb}</span>
              </button>
            );
          })}
        </div>
      </main>

      <footer style={st.pairFooter}>
        <button type="button" style={st.pairPrevious} onClick={previousCell} disabled={cellNumber === 1}>← Previous</button>
        <div style={st.pairFooterStatus}>
          <span>{saveErr ? "⚠ Save issue" : backendReady ? "Autosaved" : "Preview mode"} · Row {activeRow + 1} of {R}</span>
          <span>Press 1–4 to score · Enter to continue</span>
        </div>
        <button type="button" style={st.pairNext} onClick={advance}>
          {cellNumber < totalCells ? "Save & next →" : pair + 1 < CUE_PAIRS.length ? "Save & next matrix →" : "Save & finish →"}
        </button>
      </footer>

      {showMatrixOverview && (
        <div style={st.matrixOverlay} role="dialog" aria-modal="true" aria-label="Matrix overview">
          <div style={st.matrixView}>
            <header style={st.matrixViewToolbar}>
              <div style={st.taskCuePair}>
                <div><b style={{ ...st.taskCueWord, fontFamily: FONT_CJK }}>{task.cueL1.w}</b><span style={st.taskCueLanguage}>{languageName(task.cueL1.lang, "Language 1")}</span></div>
                <span style={st.taskCueArrow}>↔</span>
                <div><b style={st.taskCueWord}>{task.cueL2.w}</b><span style={st.taskCueLanguage}>{languageName(task.cueL2.lang, "English")}</span></div>
              </div>
              <div style={st.taskProgress}>
                <span style={st.taskProgressText}>Matrix {pair + 1}/{CUE_PAIRS.length} · Row {activeRow + 1}/{R}</span>
                <div style={st.taskProgressTrack}><div style={{ ...st.taskProgressFill, width: `${(activeRow / R) * 100}%` }} /></div>
              </div>
              <div style={st.matrixViewActions}>
                <span style={{ color: "#176b68", fontWeight: 800 }}>Scoring guide ⚙</span>
                <button type="button" style={st.secondary} onClick={() => setShowMatrixOverview(false)}>Pair-by-pair view</button>
              </div>
            </header>

            <p style={st.taskPrompt}>Select a cell, then press 1–4 to score.</p>

            <div style={{ ...st.gridScroll, ...st.matrixViewGrid }}>
              <table style={{ ...st.table, tableLayout: "fixed" }}>
                <colgroup><col style={{ width: labelWidth }} />{task.cols.map((cw) => <col key={cw} style={{ width: 82 }} />)}</colgroup>
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ ...st.taskAxisHead, width: labelWidth }}>{languageName(task.cueL1.lang, "Language 1")}</th>
                    <th colSpan={C} style={st.taskAssociationHead}>{languageName(task.cueL2.lang, "English")} associations</th>
                  </tr>
                  <tr>{task.cols.map((cw, c) => <th key={cw} style={{ ...st.colHead, ...st.taskColHead, ...(c === 0 ? st.colHeadCue : {}) }}>{cw}</th>)}</tr>
                </thead>
                <tbody>
                  {task.rows.map((rw, r) => (
                    <tr key={rw.w}>
                      <th style={{ ...st.rowHead, width: labelWidth, ...(r === 0 ? st.rowHeadCue : {}) }}>{rw.w}</th>
                      {task.cols.map((cw, c) => {
                        const value = explicit(r, c);
                        const band = value !== undefined ? bandOf(value) : null;
                        const selected = r === activeRow && c === col;
                        return (
                          <td
                            key={cw}
                            onClick={() => { setActiveRow(r); setCol(c); }}
                            style={{ ...st.taskCell, ...(band ? { background: band.c, color: band.ink } : {}), ...(selected && !band ? st.cellCursor : {}), cursor: "pointer" }}
                          >
                            {value !== undefined && value !== 0 ? value.toFixed(1) : ""}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <footer style={st.matrixViewFooter}>
              <span style={st.taskSaveStatus}>{saveErr ? "⚠ Save issue" : backendReady ? "✓ Autosaved" : "Preview mode"}</span>
              <span style={st.hint}>Keys: <kbd style={st.kbd}>1</kbd> <kbd style={st.kbd}>2</kbd> <kbd style={st.kbd}>3</kbd> <kbd style={st.kbd}>4</kbd> to score · <kbd style={st.kbd}>Enter</kbd> next</span>
              <div style={st.taskScoreButtons}>
                {BANDS.map((b) => (
                  <button key={b.v} onClick={() => setCell(col, b.v)} style={{ ...st.taskScoreButton, borderColor: b.c }}>
                    <span style={{ ...st.taskScoreKey, color: b.v <= 0.5 ? b.ink : b.c }}>{b.key}</span>
                    <span style={st.taskScoreLabel}>{b.label}</span>
                    <span style={st.taskScoreValue}>{b.v.toFixed(1)}</span>
                  </button>
                ))}
              </div>
              <button type="button" style={{ ...st.primary, ...st.taskNextButton }} onClick={advance}>Next cell →</button>
            </footer>
          </div>
        </div>
      )}
      </Shell>
    </>
  );
}

const CONSENT_RESEARCHERS = [
  { name: "Dr Simon De Deyne", role: "Responsible Researcher", email: "simon.dedeyne@unimelb.edu.au" },
  { name: "Dr Lea Frermann", role: "Additional Researcher", email: "lea.frermann@unimelb.edu.au" },
  { name: "Dr Chunhua Liu", role: "Additional Researcher", email: "chunhua.liu1@unimelb.edu.au" },
  { name: "Dr Kabir Manandhar Shrestha", role: "Additional Researcher", email: "k.manandharshrestha@unimelb.edu.au" },
  { name: "Dr Anna Cheung", role: "Additional Researcher", email: "onyuanna.cheung@student.unimelb.edu.au" },
];

const CONSENT_POINTS = [
  "I understand that this research aims to investigate how meaning varies across languages.",
  "I understand that my participation in this project is for research purposes only.",
  "I acknowledge that the possible effects of participating in this research project have been explained to my satisfaction.",
  "For this project, I will be required to answer demographic questions, a vocabulary test, and participate in a word meaning judgement task.",
  "I understand that my participation is voluntary, that I am free to withdraw from this project anytime without explanation or prejudice, and that I am free to withdraw any unprocessed data I have provided.",
  "I understand that my raw data without any de-identified information will be stored at the University of Melbourne for a period of five years and will be made publicly available within a period of 12 months of publication.",
  "I have been informed that the confidentiality of the information I provide will be safeguarded; my data will be password-protected and accessible only to the named researchers.",
];

function ExampleMatrixTable({ matrix, highlightCorner }) {
  const labelWidth = labelColWidth(matrix.rows);
  return (
    <div style={st.gridScroll}>
      <table style={{ ...st.table, tableLayout: "fixed" }}>
        <thead>
          <tr>
            <th style={{ ...st.corner, width: labelWidth, minWidth: labelWidth, maxWidth: labelWidth, ...(highlightCorner ? { boxShadow: "inset 0 0 0 3px #d9a23b" } : {}) }} />
            {matrix.cols.map((cw, ci) => (
              <th key={cw} style={{ ...st.colHead, ...(ci === 0 ? st.colHeadCue : {}) }}>
                {cw}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((rw, ri) => (
            <tr key={rw.w}>
              <th style={{ ...st.rowHead, width: labelWidth, minWidth: labelWidth, maxWidth: labelWidth, ...(ri === 0 ? st.rowHeadCue : {}) }}>
                <span style={{ display: "block", fontFamily: FONT_CJK, fontSize: 17, fontWeight: 700 }}>{rw.w}</span>
                <span style={st.rowHeadGloss}>{rw.gloss}</span>
              </th>
              {rw.vals.map((v, c) => {
                const b = v !== null ? bandOf(v) : null;
                return (
                  <td key={c} style={{ ...st.cell, ...(b ? { background: b.c, color: b.ink, ...(v === 0 ? st.cellZero : {}) } : { background: "#fff" }) }}>
                    {b ? (v === 0 ? "·" : v.toFixed(1)) : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConsentModal({ onClose }) {
  return (
    <div style={st.modalOverlay} onClick={onClose}>
      <div style={st.modalCard} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="consent-title">
        <div style={st.modalHead}>
          <div>
            <div style={st.kicker}>Project ID 34544 · Consent Form v1</div>
            <h2 id="consent-title" style={{ ...st.h1, fontSize: 22, margin: 0 }}>Bilingual Perspectives on Crosslingual Semantic Variation</h2>
          </div>
          <button style={st.modalClose} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={st.modalBody}>
          <p style={{ ...st.lead, margin: "0 0 16px" }}>Melbourne School of Psychological Sciences</p>
          {CONSENT_RESEARCHERS.map((r) => (
            <div key={r.email} style={{ fontSize: 14, color: "#4b515a", marginBottom: 4 }}>
              <b>{r.name}</b> {r.role === "Responsible Researcher" ? "(Responsible Researcher)" : ""} — {r.email}
            </div>
          ))}
          <p style={{ ...st.lead, margin: "18px 0" }}>
            I consent to participate in this project, the details of which have been explained to me, and I have
            been provided with a written Plain Language Statement to keep.
          </p>
          <ol style={{ ...st.lead, margin: 0, paddingLeft: 20 }}>
            {CONSENT_POINTS.map((p, i) => (
              <li key={i} style={{ marginBottom: 12 }}>{p}</li>
            ))}
          </ol>
          <p style={{ ...st.lead, margin: "18px 0 0", fontStyle: "italic" }}>By clicking "Proceed", I agree to participate in this study.</p>
        </div>
      </div>
    </div>
  );
}

const TRANSLATION_TYPE_OPTIONS = [
  { v: "written", label: "Written translation" },
  { v: "spoken", label: "Spoken interpreting (simultaneous or consecutive)" },
  { v: "subtitling", label: "Subtitling or audiovisual media translation" },
  { v: "localisation", label: "Localisation (software, games, advertising, etc.)" },
  { v: "other", label: "Other" },
  { v: "na", label: "Not Applicable" },
];

const EMPTY_DEMOGRAPHICS = {
  nationality: "", postcode: "", occupation: "", age: "",
  gender: "", genderOther: "",
  education: "", native_language: "",
  translationExperience: "",
  translationTypes: [], translationTypesOther: "",
  translationYears: "",
};

function Demographics({ onBack, onSubmit }) {
  const [d, setD] = useState(EMPTY_DEMOGRAPHICS);
  const [errors, setErrors] = useState({});

  const set = (k, v) => {
    setD((s) => ({ ...s, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  };
  const toggleType = (v) => {
    setD((s) => {
      if (v === "na") return { ...s, translationTypes: s.translationTypes.includes("na") ? [] : ["na"] };
      const withoutNa = s.translationTypes.filter((x) => x !== "na");
      return {
        ...s,
        translationTypes: withoutNa.includes(v) ? withoutNa.filter((x) => x !== v) : [...withoutNa, v],
      };
    });
    setErrors((e) => (e.translationTypes ? { ...e, translationTypes: undefined } : e));
  };

  const validate = () => {
    const e = {};
    if (!d.nationality.trim()) e.nationality = "Required";
    if (!d.postcode.trim()) e.postcode = "Required";
    if (!d.occupation.trim()) e.occupation = "Required";
    const ageNum = Number(d.age);
    if (!d.age || !Number.isInteger(ageNum) || ageNum < 18 || ageNum > 100) e.age = "Enter an age between 18 and 100";
    if (!d.gender) e.gender = "Required";
    if (d.gender === "other" && !d.genderOther.trim()) e.genderOther = "Please describe";
    if (!d.education) e.education = "Required";
    if (!d.native_language.trim()) e.native_language = "Required";
    if (!d.translationExperience) e.translationExperience = "Required";
    if (d.translationTypes.length === 0) e.translationTypes = "Select at least one";
    if (d.translationTypes.includes("other") && !d.translationTypesOther.trim()) e.translationTypesOther = "Please describe";
    if (!d.translationYears) e.translationYears = "Required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => {
    if (!validate()) return;
    onSubmit(d);
  };

  return (
    <Shell>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 0 80px" }}>
        <div style={st.kicker}>Before you begin</div>
        <h1 style={st.h1}>A few questions about you</h1>
        <p style={st.lead}>
          This information helps us describe our participant sample. Your answers are kept confidential and are not linked to your identity outside this study.
        </p>

        <div style={st.fieldGroup}>
          <label style={st.fieldLabel}>What is your nationality?</label>
          <input style={{ ...st.fieldInput, ...(errors.nationality ? st.fieldInputError : {}) }} value={d.nationality} onChange={(e) => set("nationality", e.target.value)} />
          {errors.nationality && <div style={st.fieldError}>{errors.nationality}</div>}
        </div>

        <div style={st.fieldGroup}>
          <label style={st.fieldLabel}>Where do you live (postcode)?</label>
          <input style={{ ...st.fieldInput, ...(errors.postcode ? st.fieldInputError : {}) }} value={d.postcode} onChange={(e) => set("postcode", e.target.value)} />
          {errors.postcode && <div style={st.fieldError}>{errors.postcode}</div>}
        </div>

        <div style={st.fieldGroup}>
          <label style={st.fieldLabel}>What's your occupation?</label>
          <input style={{ ...st.fieldInput, ...(errors.occupation ? st.fieldInputError : {}) }} value={d.occupation} onChange={(e) => set("occupation", e.target.value)} />
          {errors.occupation && <div style={st.fieldError}>{errors.occupation}</div>}
        </div>

        <div style={st.fieldGroup}>
          <label style={st.fieldLabel}>How old are you?<span style={st.fieldHint}>18–100</span></label>
          <input type="number" min={18} max={100} style={{ ...st.fieldInput, ...(errors.age ? st.fieldInputError : {}) }} value={d.age} onChange={(e) => set("age", e.target.value)} />
          {errors.age && <div style={st.fieldError}>{errors.age}</div>}
        </div>

        <div style={st.fieldGroup}>
          <label style={st.fieldLabel}>How do you describe your gender?</label>
          {[["male", "Male"], ["female", "Female"], ["nonbinary", "Non-binary/third gender"], ["other", "Other"], ["prefer_not", "Prefer not to say"]].map(([v, label]) => (
            <label key={v} style={st.optionRow}>
              <input type="radio" name="gender" style={st.optionInput} checked={d.gender === v} onChange={() => set("gender", v)} />
              <span>{label}</span>
            </label>
          ))}
          {d.gender === "other" && (
            <div style={st.subFields}>
              <input style={{ ...st.fieldInput, ...(errors.genderOther ? st.fieldInputError : {}) }} placeholder="Please describe" value={d.genderOther} onChange={(e) => set("genderOther", e.target.value)} />
              {errors.genderOther && <div style={st.fieldError}>{errors.genderOther}</div>}
            </div>
          )}
          {errors.gender && <div style={st.fieldError}>{errors.gender}</div>}
        </div>

        <div style={st.fieldGroup}>
          <label style={st.fieldLabel}>What is the highest level of education you have completed?</label>
          <select style={{ ...st.fieldSelect, ...(errors.education ? st.fieldInputError : {}) }} value={d.education} onChange={(e) => set("education", e.target.value)}>
            <option value="">Select…</option>
            {["Less than Primary", "Primary", "Some Secondary", "Secondary", "Vocational or Similar", "Some University but no degree", "University - Bachelors Degree", "Graduate or professional degree (MA, MS, MBA, PhD, Law Degree, Medical Degree etc.)", "Prefer not to say"].map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          {errors.education && <div style={st.fieldError}>{errors.education}</div>}
        </div>

        <div style={st.fieldGroup}>
          <label style={st.fieldLabel}>What is your native language?</label>
          <input
            style={{ ...st.fieldInput, ...(errors.native_language ? st.fieldInputError : {}) }}
            value={d.native_language}
            onChange={(e) => set("native_language", e.target.value)}
          />
          {errors.native_language && <div style={st.fieldError}>{errors.native_language}</div>}
        </div>

        <h2 style={st.sectionTitle}>Professional translation experience</h2>

        <div style={st.fieldGroup}>
          <label style={st.fieldLabel}>Have you ever worked as a translator or interpreter in a professional capacity?<span style={st.fieldHint}>Paid or unpaid, including formal internships, freelance work, or regular volunteer roles</span></label>
          {[["no", "No, never"], ["occasional", "Yes, occasionally (limited experience, short projects or informal work)"], ["regular", "Yes, regularly (ongoing freelance or part-time work)"], ["full_time", "Yes, full-time or as a major part of my professional work"]].map(([v, label]) => (
            <label key={v} style={st.optionRow}>
              <input type="radio" name="translationExperience" style={st.optionInput} checked={d.translationExperience === v} onChange={() => set("translationExperience", v)} />
              <span>{label}</span>
            </label>
          ))}
          {errors.translationExperience && <div style={st.fieldError}>{errors.translationExperience}</div>}
        </div>

        <p style={{ ...st.lead, margin: "0 0 18px", fontSize: 14.5 }}>
          If you answered "Yes" above, please fill in the following two questions. If you answered "No, never", choose "Not Applicable".
        </p>

        <div style={st.fieldGroup}>
          <label style={st.fieldLabel}>What types of translation/interpreting have you done?<span style={st.fieldHint}>Select all that apply</span></label>
          {TRANSLATION_TYPE_OPTIONS.map((o) => (
            <label key={o.v} style={st.optionRow}>
              <input type="checkbox" style={st.optionInput} checked={d.translationTypes.includes(o.v)} onChange={() => toggleType(o.v)} />
              <span>{o.label}</span>
            </label>
          ))}
          {d.translationTypes.includes("other") && (
            <div style={st.subFields}>
              <input style={{ ...st.fieldInput, ...(errors.translationTypesOther ? st.fieldInputError : {}) }} placeholder="Please describe" value={d.translationTypesOther} onChange={(e) => set("translationTypesOther", e.target.value)} />
              {errors.translationTypesOther && <div style={st.fieldError}>{errors.translationTypesOther}</div>}
            </div>
          )}
          {errors.translationTypes && <div style={st.fieldError}>{errors.translationTypes}</div>}
        </div>

        <div style={st.fieldGroup}>
          <label style={st.fieldLabel}>How long have you had professional translation experience?</label>
          {[["<1", "Less than 1 year"], ["1-3", "1–3 years"], ["4-7", "4–7 years"], ["7+", "More than 7 years"], ["na", "Not Applicable"]].map(([v, label]) => (
            <label key={v} style={st.optionRow}>
              <input type="radio" name="translationYears" style={st.optionInput} checked={d.translationYears === v} onChange={() => set("translationYears", v)} />
              <span>{label}</span>
            </label>
          ))}
          {errors.translationYears && <div style={st.fieldError}>{errors.translationYears}</div>}
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
          <button
            style={{ ...st.primary, background: "#fff", color: "#26292e", border: "1px solid #d8d4ca" }}
            onClick={onBack}
          >
            ← Back
          </button>
          <button style={{ ...st.primary, fontSize: 16, padding: "14px 28px" }} onClick={handleNext}>
            Continue →
          </button>
        </div>
      </div>
    </Shell>
  );
}

function RatingScale({ value, onChange }) {
  return (
    <div style={st.ratingRow}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          style={{ ...st.ratingBtn, ...(value === n ? st.ratingBtnActive : {}) }}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

const EMPTY_FEEDBACK = {
  interest: null, difficulty: null, difficultyWhere: "",
  motivation: null, suggestions: "",
};

function Feedback({ onSubmit }) {
  const [f, setF] = useState(EMPTY_FEEDBACK);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const set = (k, v) => {
    setF((s) => ({ ...s, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  };

  const validate = () => {
    const e = {};
    if (!f.interest) e.interest = "Required";
    if (!f.difficulty) e.difficulty = "Required";
    if (!f.motivation) e.motivation = "Required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate() || submitting) return;
    setSubmitting(true);
    await onSubmit(f);
  };

  return (
    <Shell>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 0 80px" }}>
        <div style={st.kicker}>Last step</div>
        <h1 style={st.h1}>Tell us about your experience</h1>
        <p style={st.lead}>
          Your annotations are saved. This short feedback helps us improve the task before the full study — it should take under a minute.
        </p>

        <div style={st.fieldGroup}>
          <label style={st.fieldLabel}>How interesting did you find the task?<span style={st.fieldHint}>1 = not at all interesting, 10 = extremely interesting</span></label>
          <RatingScale value={f.interest} onChange={(v) => set("interest", v)} />
          {errors.interest && <div style={st.fieldError}>{errors.interest}</div>}
        </div>

        <div style={st.fieldGroup}>
          <label style={st.fieldLabel}>How difficult did you find the task?<span style={st.fieldHint}>1 = very easy, 10 = very difficult</span></label>
          <RatingScale value={f.difficulty} onChange={(v) => set("difficulty", v)} />
          {errors.difficulty && <div style={st.fieldError}>{errors.difficulty}</div>}
          <div style={st.subFields}>
            <label style={{ ...st.fieldLabel, fontSize: 13.5, fontWeight: 600 }}>If it was difficult, where or why?</label>
            <textarea
              style={{ ...st.fieldInput, maxWidth: "100%", minHeight: 70, resize: "vertical" }}
              value={f.difficultyWhere}
              onChange={(e) => set("difficultyWhere", e.target.value)}
              placeholder="Optional — e.g. specific word pairs, unfamiliar vocabulary, unclear instructions…"
            />
          </div>
        </div>

        <div style={st.fieldGroup}>
          <label style={st.fieldLabel}>How motivated were you to do the task well?<span style={st.fieldHint}>1 = not at all motivated, 10 = extremely motivated</span></label>
          <RatingScale value={f.motivation} onChange={(v) => set("motivation", v)} />
          {errors.motivation && <div style={st.fieldError}>{errors.motivation}</div>}
        </div>

        <div style={st.fieldGroup}>
          <label style={st.fieldLabel}>Do you have any suggestions for us to improve?</label>
          <textarea
            style={{ ...st.fieldInput, maxWidth: "100%", minHeight: 90, resize: "vertical" }}
            value={f.suggestions}
            onChange={(e) => set("suggestions", e.target.value)}
            placeholder="Optional"
          />
        </div>

        <button
          style={{ ...st.primary, marginTop: 16, fontSize: 16, padding: "14px 28px", ...(submitting ? st.primaryDisabled : {}) }}
          disabled={submitting}
          onClick={handleSubmit}
        >
          {submitting ? "Submitting…" : "Submit →"}
        </button>
      </div>
    </Shell>
  );
}

function Practice({ examples, onBack, onComplete }) {
  const [exampleIndex, setExampleIndex] = useState(0);
  const [activeRow, setActiveRow] = useState(0);
  const [col, setCol] = useState(0);
  const [hoverCol, setHoverCol] = useState(null);
  const [scores, setScores] = useState({});
  const [rowFeedback, setRowFeedback] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showPracticeOverview, setShowPracticeOverview] = useState(false);
  const example = examples[exampleIndex];
  const isLastExample = exampleIndex === examples.length - 1;
  const key = (r, c) => `${exampleIndex}|${r}|${c}`;
  const explicit = (r, c) => scores[key(r, c)];
  const visibleRows = showFeedback ? example.rows.length : activeRow + 1;
  const labelWidth = labelColWidth(example.rows);

  useLayoutEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [exampleIndex, activeRow, showFeedback]);

  const setCell = (c, value) => {
    setScores((s) => ({ ...s, [key(activeRow, c)]: value }));
  };

  const advanceRow = () => {
    const filled = { ...scores };
    example.cols.forEach((_, c) => {
      const k = key(activeRow, c);
      if (filled[k] === undefined) filled[k] = 0.0;
    });
    setScores(filled);
    setRowFeedback(true);
  };

  const advanceCell = () => {
    if (col + 1 < example.cols.length) { setCol((c) => c + 1); return; }
    advanceRow();
  };

  const previousCell = () => {
    if (col > 0) { setCol((c) => c - 1); return; }
    if (activeRow > 0) { setActiveRow((r) => r - 1); setCol(example.cols.length - 1); }
  };

  const continueAfterRowFeedback = () => {
    if (activeRow + 1 < example.rows.length) {
      setActiveRow((r) => r + 1);
      setCol(0);
      setRowFeedback(false);
    } else {
      setShowFeedback(true);
      setRowFeedback(false);
    }
  };

  const results = [];
  example.rows.forEach((row, r) => {
    example.cols.forEach((word, c) => {
      const expected = example.answers[r][c];
      const given = explicit(r, c) ?? 0.0;
      if (given !== expected) {
        results.push({
          pair: `${row.w} × ${word}`,
          given,
          expected,
          explanation: example.explanations[`${r}|${c}`]
            || (expected === 0
              ? "These words may share a topic or context, but they do not denote the same concept. Shared domain alone must be scored 0."
              : `This pair matches the ${expected.toFixed(1)} definition in the instructions.`),
        });
      }
    });
  });
  const totalCells = example.rows.length * example.cols.length;
  const currentRowResults = example.cols.map((word, c) => {
    const expected = example.answers[activeRow][c];
    const given = explicit(activeRow, c) ?? 0.0;
    return {
      c,
      pair: `${example.rows[activeRow].w} × ${word}`,
      given,
      expected,
      correct: given === expected,
      explanation: example.explanations[`${activeRow}|${c}`]
        || (expected === 0
          ? "The words may share a topic or situation, but they do not denote the same concept. Shared context must be scored 0."
          : `This relationship matches the ${expected.toFixed(1)} definition in the instructions.`),
    };
  });
  const currentRowErrors = currentRowResults.filter((result) => !result.correct);

  const nextExample = () => {
    if (isLastExample) {
      onComplete();
      return;
    }
    setExampleIndex((i) => i + 1);
    setActiveRow(0);
    setCol(0);
    setRowFeedback(false);
    setShowFeedback(false);
  };

  useEffect(() => {
    if (showFeedback) return undefined;
    const handleKey = (event) => {
      if (rowFeedback) {
        if (event.key === "Enter") {
          event.preventDefault();
          continueAfterRowFeedback();
        }
        return;
      }
      const band = BANDS.find((item) => item.key === event.key);
      if (band) {
        event.preventDefault();
        setCell(col, band.v);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setCol((c) => Math.min(c + 1, example.cols.length - 1));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setCol((c) => Math.max(c - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        advanceCell();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  return (
    <Shell wide>
      <div style={{ padding: "20px 0 60px" }}>
        <header style={st.pairTopBar}>
          <span style={st.pairMatrixCount}>Practice {exampleIndex + 1} of {examples.length}</span>
          <div style={st.pairCellProgress}>
            <span>Cell {activeRow * example.cols.length + col + 1} of {totalCells}</span>
            <div style={st.taskProgressTrack}><div style={{ ...st.taskProgressFill, width: `${((activeRow * example.cols.length + col) / totalCells) * 100}%` }} /></div>
          </div>
          <details style={st.taskGuide}>
            <summary style={st.pairGuideSummary}>▣&nbsp; Scoring guide</summary>
            <div style={st.taskGuideBody}>
            {INSTRUCTION_SECTIONS.map((section) => {
              const band = bandOf(section.score);
              return (
                <div key={section.score} style={{ ...st.referenceRow, marginBottom: 12 }}>
                  <span style={{ ...st.referenceScore, background: band.c, color: band.ink }}>
                    {section.score.toFixed(1)}
                  </span>
                  <div>
                    <div><b>{section.title}</b></div>
                    <p style={{ margin: "3px 0 6px", lineHeight: 1.5 }}>{section.summary}</p>
                    <InstructionLists section={section} />
                  </div>
                </div>
              );
            })}
            <div style={{ fontWeight: 800, margin: "8px 0 5px" }}>Scoring discipline</div>
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5 }}>
              {SCORING_DISCIPLINE.map((rule) => <li key={rule} style={{ marginBottom: 4 }}>{rule}</li>)}
            </ul>
            </div>
          </details>
        </header>

        {!showFeedback && !rowFeedback && (
          <main style={st.pairPage}>
            <div style={st.pairCueLabel}>Cue words</div>
            <div style={st.pairCuePair}>
              <div><b style={{ ...st.pairCueWord, fontFamily: FONT_CJK }}>{example.cueL1.w}</b><span style={st.pairLanguage}>{languageName(example.cueL1.lang, "Language 1")}</span></div>
              <span style={st.pairArrow}>↔</span>
              <div><b style={st.pairCueWord}>{example.cueL2.w}</b><span style={st.pairLanguage}>{languageName(example.cueL2.lang, "English")}</span></div>
            </div>
            <button type="button" style={st.pairOverviewLink} onClick={() => setShowPracticeOverview(true)}>Open matrix overview</button>
            <p style={{ ...st.taskPrompt, textAlign: "center" }}><b>{example.label}:</b> {example.context}</p>
            <section style={st.pairQuestionCard}>
              <h1 style={st.pairQuestionTitle}>{activeRow === 0 && col === 0 ? "How equivalent are these cue words?" : "How equivalent are these associations?"}</h1>
              <div style={st.pairAssociationGrid}>
                <div style={st.pairAssociationCard}><span style={st.pairAssociationLanguage}>{languageName(example.cueL1.lang, "Language 1")} {activeRow === 0 && col === 0 ? "cue word" : "association"}</span><b style={{ ...st.pairAssociationWord, fontFamily: FONT_CJK }}>{example.rows[activeRow].w}</b></div>
                <span style={st.pairAssociationArrow}>↔</span>
                <div style={st.pairAssociationCard}><span style={st.pairAssociationLanguage}>{languageName(example.cueL2.lang, "English")} {activeRow === 0 && col === 0 ? "cue word" : "association"}</span><b style={st.pairAssociationWord}>{example.cols[col]}</b></div>
              </div>
              <p style={st.pairQuestionHint}>{activeRow === 0 && col === 0 ? "These cue words anchor the matrix. Could one replace the other in context while keeping the meaning?" : "Could one replace the other in context while keeping the meaning?"}</p>
            </section>
            <div style={st.pairScoreList}>
              {BANDS.map((band) => {
                const accent = band.v === 1 ? "#176b58" : band.v === 0.8 ? "#3f754c" : band.v === 0.5 ? "#ad6d00" : "#4b515a";
                const selected = explicit(activeRow, col) === band.v;
                return <button key={band.v} onClick={() => setCell(col, band.v)} style={{ ...st.pairScoreOption, borderColor: band.c, ...(selected ? { background: `${band.c}18`, boxShadow: `inset 0 0 0 2px ${accent}` } : {}) }}>
                  <span style={st.pairPress}>Press <b style={{ ...st.pairPressKey, color: accent }}>{band.key}</b></span>
                  <strong style={{ ...st.pairScoreNumber, color: accent }}>{band.v.toFixed(1)}</strong>
                  <strong style={{ ...st.pairScoreName, color: accent }}>{band.label}</strong>
                  <span style={st.pairScoreDescription}>{band.blurb}</span>
                </button>;
              })}
            </div>
          </main>
        )}

        {!showFeedback && !rowFeedback && (
          <footer style={st.pairFooter}>
            <button style={st.pairPrevious} onClick={previousCell} disabled={activeRow === 0 && col === 0}>← Previous</button>
            <div style={st.pairFooterStatus}><span>Practice · Row {activeRow + 1} of {example.rows.length}</span><span>Press 1–4 to score · Enter to continue</span></div>
            <button style={st.pairNext} onClick={advanceCell}>{col + 1 < example.cols.length ? "Next pair →" : "Check row →"}</button>
          </footer>
        )}

        {rowFeedback && (
          <div role="status" style={st.rowFeedbackPanel}>
            <div style={{ ...st.practiceFeedback, marginTop: 0, ...(currentRowErrors.length === 0 ? st.practiceFeedbackCorrect : st.practiceFeedbackError) }}>
              <strong>
                {currentRowErrors.length === 0
                  ? `Correct — all ${example.cols.length} cells in this row are right.`
                  : `${example.cols.length - currentRowErrors.length} of ${example.cols.length} cells in this row are correct.`}
              </strong>{" "}
              {currentRowErrors.length === 0
                ? "Good work. Green outlines mark the correct judgments."
                : "Green outlines are correct; red outlines need review."}
            </div>
            {currentRowResults.map((result) => (
              <div
                key={result.pair}
                style={{
                  ...st.practiceCorrection,
                  ...(result.correct ? st.practiceCorrectionCorrect : st.practiceCorrectionError),
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <strong>{result.pair}</strong>
                  <strong>{result.correct ? "✓ Correct" : "✕ Needs review"}</strong>
                </div>
                <div style={{ margin: "4px 0" }}>
                  Your score: {result.given.toFixed(1)} · Expected: <b>{result.expected.toFixed(1)}</b>
                </div>
                <div>{result.explanation}</div>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button style={st.primary} onClick={continueAfterRowFeedback}>
                {activeRow + 1 < example.rows.length ? "Continue to next row →" : "See practice summary →"}
              </button>
            </div>
          </div>
        )}

        {showFeedback && (
          <div role="status">
            <button type="button" style={{ ...st.secondary, marginBottom: 14 }} onClick={() => setShowPracticeOverview(true)}>
              Open completed matrix overview
            </button>
            <div style={{ ...st.practiceFeedback, ...(results.length === 0 ? st.practiceFeedbackCorrect : st.practiceFeedbackError) }}>
              <strong>
                {results.length === 0
                  ? `Excellent — all ${totalCells} cells are correct.`
                  : `${totalCells - results.length} of ${totalCells} cells are correct.`}
              </strong>{" "}
              {results.length === 0
                ? "You applied the equivalence criteria accurately."
                : "Review the corrections below and connect them to the scoring definitions before continuing."}
            </div>
            {results.map((result) => (
              <div key={result.pair} style={st.practiceCorrection}>
                <strong>{result.pair}</strong>
                <div style={{ margin: "4px 0" }}>
                  Your score: {result.given.toFixed(1)} · Expected: <b>{result.expected.toFixed(1)}</b>
                </div>
                <div>{result.explanation}</div>
              </div>
            ))}
            {isLastExample && (
              <div style={{ ...st.infoStrip, margin: "16px 0 0", background: "#fbf6ea", border: "1px solid #ecdcb6" }}>
                <strong>Heads up:</strong> Next, you will complete a short test. You must fill all cells correctly test before you can continue to the real annotations. If they are not correct, you can update the update the scores directly or review the instructions and practice examples before trying again.
              </div>
            )}
            <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
              <button style={st.secondary} onClick={onBack}>← Back to instructions</button>
              <button style={st.primary} onClick={nextExample}>
                {isLastExample ? "Are you ready for a test? →" : "Next practice matrix →"}
              </button>
            </div>
          </div>
        )}

        {showPracticeOverview && (
          <div style={st.matrixOverlay} role="dialog" aria-modal="true" aria-label="Practice matrix overview">
            <div style={st.matrixView}>
              <header style={st.matrixViewToolbar}>
                <div style={st.taskCuePair}>
                  <div><b style={{ ...st.taskCueWord, fontFamily: FONT_CJK }}>{example.cueL1.w}</b><span style={st.taskCueLanguage}>{languageName(example.cueL1.lang, "Language 1")}</span></div>
                  <span style={st.taskCueArrow}>↔</span>
                  <div><b style={st.taskCueWord}>{example.cueL2.w}</b><span style={st.taskCueLanguage}>{languageName(example.cueL2.lang, "English")}</span></div>
                </div>
                <div style={st.taskProgress}>
                  <span style={st.taskProgressText}>Practice {exampleIndex + 1}/{examples.length} · {showFeedback ? "Complete" : `Row ${activeRow + 1}/${example.rows.length}`}</span>
                  <div style={st.taskProgressTrack}><div style={{ ...st.taskProgressFill, width: `${showFeedback ? 100 : ((activeRow * example.cols.length + col) / totalCells) * 100}%` }} /></div>
                </div>
                <div style={st.matrixViewActions}>
                  <span style={{ color: "#176b68", fontWeight: 800 }}>{showFeedback ? "Completed matrix" : "Progress so far"}</span>
                  <button type="button" style={st.secondary} onClick={() => setShowPracticeOverview(false)}>Pair-by-pair view</button>
                </div>
              </header>

              <p style={st.taskPrompt}>
                {showFeedback ? "The full annotated matrix is shown. Select any cell to revisit it." : "Only rows reached so far are shown. Select a visited cell to revisit it."}
              </p>

              <div style={{ ...st.gridScroll, ...st.matrixViewGrid }}>
                <table style={{ ...st.table, tableLayout: "fixed" }}>
                  <colgroup><col style={{ width: labelWidth }} />{example.cols.map((word) => <col key={word} style={{ width: 100 }} />)}</colgroup>
                  <thead>
                    <tr>
                      <th rowSpan={2} style={{ ...st.taskAxisHead, width: labelWidth }}>{languageName(example.cueL1.lang, "Language 1")}</th>
                      <th colSpan={example.cols.length} style={st.taskAssociationHead}>{languageName(example.cueL2.lang, "English")} associations</th>
                    </tr>
                    <tr>{example.cols.map((word, c) => <th key={word} style={{ ...st.colHead, ...st.taskColHead, ...(c === 0 ? st.colHeadCue : {}) }}>{word}</th>)}</tr>
                  </thead>
                  <tbody>
                    {example.rows.slice(0, showFeedback ? example.rows.length : activeRow + 1).map((row, r) => (
                      <tr key={row.w}>
                        <th style={{ ...st.rowHead, width: labelWidth, ...(r === 0 ? st.rowHeadCue : {}) }}>{row.w}</th>
                        {example.cols.map((word, c) => {
                          const value = explicit(r, c);
                          const band = value !== undefined ? bandOf(value) : null;
                          return (
                            <td
                              key={word}
                              onClick={() => {
                                setActiveRow(r);
                                setCol(c);
                                setRowFeedback(false);
                                setShowFeedback(false);
                                setShowPracticeOverview(false);
                              }}
                              style={{ ...st.taskCell, ...(band ? { background: band.c, color: band.ink } : {}), cursor: "pointer" }}
                            >
                              {value !== undefined && value !== 0 ? value.toFixed(1) : ""}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <footer style={st.matrixViewFooter}>
                <span style={st.taskSaveStatus}>{showFeedback ? "✓ Practice matrix complete" : `✓ ${activeRow * example.cols.length + col + 1} of ${totalCells} pairs reached`}</span>
                <span style={st.hint}>Select a displayed cell to revisit its pair.</span>
                <button type="button" style={{ ...st.primary, ...st.taskNextButton }} onClick={() => setShowPracticeOverview(false)}>Return to pairs →</button>
              </footer>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}

function QualificationTest({ example: testExample, onBack, onPass }) {
  const [activeRow, setActiveRow] = useState(0);
  const [col, setCol] = useState(0);
  const [hoverCell, setHoverCell] = useState(null);
  const [scores, setScores] = useState({});
  const [result, setResult] = useState(null);
  const [editingCorrections, setEditingCorrections] = useState(false);
  const [wrongCells, setWrongCells] = useState([]);
  const [attempt, setAttempt] = useState(1);
  const key = (r, c) => `${r}|${c}`;
  const explicit = (r, c) => scores[key(r, c)];
  const labelWidth = labelColWidth(testExample.rows);
  const visibleRowCount = result ? testExample.rows.length : activeRow + 1;

  const setCell = (c, value) => {
    setScores((current) => ({ ...current, [key(activeRow, c)]: value }));
  };

  const advance = () => {
    const filled = { ...scores };
    testExample.cols.forEach((_, c) => {
      const k = key(activeRow, c);
      if (filled[k] === undefined) filled[k] = 0.0;
    });
    setScores(filled);
    if (activeRow + 1 < testExample.rows.length) {
      setActiveRow((row) => row + 1);
      setCol(0);
      return;
    }
    const wrong = [];
    testExample.answers.forEach((row, r) => row.forEach((expected, c) => {
      if ((filled[key(r, c)] ?? 0.0) !== expected) wrong.push(key(r, c));
    }));
    const passed = wrong.length === 0;
    setWrongCells(wrong);
    setResult(passed ? "passed" : "failed");
  };

  const advanceCell = () => {
    if (col + 1 < testExample.cols.length) { setCol((c) => c + 1); return; }
    advance();
  };

  const previousCell = () => {
    if (col > 0) { setCol((c) => c - 1); return; }
    if (activeRow > 0) { setActiveRow((r) => r - 1); setCol(testExample.cols.length - 1); }
  };

  const submitCorrections = () => {
    const wrong = [];
    testExample.answers.forEach((row, r) => row.forEach((expected, c) => {
      if ((scores[key(r, c)] ?? 0.0) !== expected) wrong.push(key(r, c));
    }));
    const passed = wrong.length === 0;
    setAttempt((value) => value + 1);
    setEditingCorrections(false);
    setWrongCells(wrong);
    setResult(passed ? "passed" : "failed");
  };

  useEffect(() => {
    if (result && !editingCorrections) return undefined;
    const handleKey = (event) => {
      const band = BANDS.find((item) => item.key === event.key);
      if (band) {
        event.preventDefault();
        setCell(col, band.v);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setCol((current) => Math.min(current + 1, testExample.cols.length - 1));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setCol((current) => Math.max(current - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (editingCorrections) submitCorrections();
        else advanceCell();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  return (
    <Shell wide>
      <div style={{ padding: "20px 0 60px" }}>
        <header style={st.pairTopBar}>
          <span style={st.pairMatrixCount}>Qualification test · Attempt {attempt}</span>
          <div style={st.pairCellProgress}>
            <span>Cell {activeRow * testExample.cols.length + col + 1} of {testExample.rows.length * testExample.cols.length}</span>
            <div style={st.taskProgressTrack}><div style={{ ...st.taskProgressFill, width: `${result ? 100 : ((activeRow * testExample.cols.length + col) / (testExample.rows.length * testExample.cols.length)) * 100}%` }} /></div>
          </div>
          <details style={st.taskGuide}>
            <summary style={st.pairGuideSummary}>▣&nbsp; Scoring guide</summary>
            <div style={st.taskGuideBody}>
            {INSTRUCTION_SECTIONS.map((section) => {
              const band = bandOf(section.score);
              return (
                <div key={section.score} style={{ ...st.referenceRow, marginBottom: 12 }}>
                  <span style={{ ...st.referenceScore, background: band.c, color: band.ink }}>
                    {section.score.toFixed(1)}
                  </span>
                  <div>
                    <div><b>{section.title}</b></div>
                    <p style={{ margin: "3px 0 6px", lineHeight: 1.5 }}>{section.summary}</p>
                    <InstructionLists section={section} />
                  </div>
                </div>
              );
            })}
            <div style={{ fontWeight: 800, margin: "8px 0 5px" }}>Scoring discipline</div>
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5 }}>
              {SCORING_DISCIPLINE.map((rule) => <li key={rule} style={{ marginBottom: 4 }}>{rule}</li>)}
            </ul>
            </div>
          </details>
        </header>

        <p style={st.taskPrompt}>Complete this matrix independently. You must pass before beginning the real task. Select a cell, then press 1–4 to score.</p>

        {result === "failed" && (
          <div style={{ ...st.practiceFeedback, ...st.practiceFeedbackError }}>
            <strong>Not passed yet.</strong>{" "}
            {editingCorrections
              ? "The matrix is unlocked. Update any scores you want to reconsider, then submit your corrections."
              : "Cells outlined in red are incorrect. Click “Update the Matrix” to unlock all cells; the expected scores will not be shown."}
          </div>
        )}
        {result === "passed" && (
          <div style={{ ...st.practiceFeedback, ...st.practiceFeedbackCorrect }}>
            <strong>Congratulations!</strong> You are ready to begin the real annotation task.
          </div>
        )}

        {!result && (
          <main style={st.pairPage}>
            <div style={st.pairCueLabel}>Cue words</div>
            <div style={st.pairCuePair}>
              <div><b style={{ ...st.pairCueWord, fontFamily: FONT_CJK }}>{testExample.cueL1.w}</b><span style={st.pairLanguage}>{languageName(testExample.cueL1.lang, "Language 1")}</span></div>
              <span style={st.pairArrow}>↔</span>
              <div><b style={st.pairCueWord}>{testExample.cueL2.w}</b><span style={st.pairLanguage}>{languageName(testExample.cueL2.lang, "English")}</span></div>
            </div>
            <section style={st.pairQuestionCard}>
              <h1 style={st.pairQuestionTitle}>{activeRow === 0 && col === 0 ? "How equivalent are these cue words?" : "How equivalent are these associations?"}</h1>
              <div style={st.pairAssociationGrid}>
                <div style={st.pairAssociationCard}><span style={st.pairAssociationLanguage}>{languageName(testExample.cueL1.lang, "Language 1")} {activeRow === 0 && col === 0 ? "cue word" : "association"}</span><b style={{ ...st.pairAssociationWord, fontFamily: FONT_CJK }}>{testExample.rows[activeRow].w}</b></div>
                <span style={st.pairAssociationArrow}>↔</span>
                <div style={st.pairAssociationCard}><span style={st.pairAssociationLanguage}>{languageName(testExample.cueL2.lang, "English")} {activeRow === 0 && col === 0 ? "cue word" : "association"}</span><b style={st.pairAssociationWord}>{testExample.cols[col]}</b></div>
              </div>
              <p style={st.pairQuestionHint}>{activeRow === 0 && col === 0 ? "These cue words anchor the matrix. Could one replace the other in context while keeping the meaning?" : "Could one replace the other in context while keeping the meaning?"}</p>
            </section>
            <div style={st.pairScoreList}>
              {BANDS.map((band) => {
                const accent = band.v === 1 ? "#176b58" : band.v === 0.8 ? "#3f754c" : band.v === 0.5 ? "#ad6d00" : "#4b515a";
                const selected = explicit(activeRow, col) === band.v;
                return <button key={band.v} onClick={() => setCell(col, band.v)} style={{ ...st.pairScoreOption, borderColor: band.c, ...(selected ? { background: `${band.c}18`, boxShadow: `inset 0 0 0 2px ${accent}` } : {}) }}>
                  <span style={st.pairPress}>Press <b style={{ ...st.pairPressKey, color: accent }}>{band.key}</b></span>
                  <strong style={{ ...st.pairScoreNumber, color: accent }}>{band.v.toFixed(1)}</strong>
                  <strong style={{ ...st.pairScoreName, color: accent }}>{band.label}</strong>
                  <span style={st.pairScoreDescription}>{band.blurb}</span>
                </button>;
              })}
            </div>
          </main>
        )}

        {result && (
        <div style={{ ...st.gridScroll, ...st.taskGridScroll }}>
          <table style={{ ...st.table, tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: labelWidth }} />
              {testExample.cols.map((word) => <col key={word} />)}
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2} style={{ ...st.taskAxisHead, width: labelWidth, minWidth: labelWidth, maxWidth: labelWidth }}>
                  {languageName(testExample.cueL1.lang, "Language 1")}
                </th>
                <th colSpan={testExample.cols.length} style={st.taskAssociationHead}>
                  {languageName(testExample.cueL2.lang, "English")} associations
                </th>
              </tr>
              <tr>
                {testExample.cols.map((word, c) => (
                  <th key={word} style={{ ...st.colHead, ...st.taskColHead, ...(!result && c === col ? st.headActive : {}), ...(c === 0 ? st.colHeadCue : {}) }}>
                    {word}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {testExample.rows.slice(0, visibleRowCount).map((row, r) => {
                const done = result || r < activeRow;
                const activeTestRow = !result && r === activeRow;
                return (
                  <tr key={row.w}>
                    <th style={{ ...st.rowHead, width: labelWidth, minWidth: labelWidth, maxWidth: labelWidth, ...(activeTestRow ? st.headActive : {}), ...(r === 0 ? st.rowHeadCue : {}) }}>
                      <span style={{ display: "block", fontSize: 17, fontWeight: 700 }}>{row.w}</span>
                      <span style={st.rowHeadGloss}>{row.gloss}</span>
                    </th>
                    {testExample.cols.map((word, c) => {
                      const value = explicit(r, c) ?? (done ? 0.0 : undefined);
                      const band = value !== undefined ? bandOf(value) : null;
                      const incorrect = result === "failed" && wrongCells.includes(key(r, c));
                      const editable = activeTestRow || (result === "failed" && editingCorrections);
                      const isCol = editable && r === activeRow && c === col;
                      const isHover = editable && hoverCell?.r === r && hoverCell?.c === c;
                      const shadows = [];
                      if (incorrect) shadows.push("inset 0 0 0 3px #c05640");
                      if (isCol && !band) shadows.push("inset 0 0 0 3px #26292e");
                      if (isHover && !isCol) shadows.push(incorrect ? "inset 0 0 0 6px rgba(192,86,64,.35)" : "inset 0 0 0 2px #9a9488");
                      return (
                        <td
                          key={word}
                          onClick={editable ? () => { setActiveRow(r); setCol(c); } : undefined}
                          onMouseEnter={editable ? () => setHoverCell({ r, c }) : undefined}
                          onMouseLeave={editable ? () => setHoverCell((current) => (current?.r === r && current?.c === c ? null : current)) : undefined}
                          style={{
                            ...st.taskCell,
                            ...(band ? { background: band.c, color: band.ink } : isCol ? { background: "#efece5" } : {}),
                            ...(done && value === 0 ? st.cellZero : {}),
                            ...(shadows.length ? { boxShadow: shadows.join(", ") } : {}),
                            cursor: editable ? "pointer" : "default",
                          }}
                        >
                          {value !== undefined && value !== 0 ? value.toFixed(1) : ""}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}

        {!result && (
          <footer style={st.pairFooter}>
            <button style={st.pairPrevious} onClick={previousCell} disabled={activeRow === 0 && col === 0}>← Previous</button>
            <div style={st.pairFooterStatus}><span>Qualification test · Row {activeRow + 1} of {testExample.rows.length}</span><span>Press 1–4 to score · Enter to continue</span></div>
            <button style={st.pairNext} onClick={advanceCell}>{col + 1 < testExample.cols.length ? "Save & next →" : activeRow + 1 < testExample.rows.length ? "Next row →" : "Submit test →"}</button>
          </footer>
        )}

        {result === "failed" && editingCorrections && (
          <div style={{ ...st.taskScoreButtons, marginTop: 18 }}>
            {BANDS.map((band) => (
              <button key={band.v} onClick={() => setCell(col, band.v)} style={{ ...st.taskScoreButton, borderColor: band.c }}>
                <span style={{ ...st.taskScoreKey, color: band.ink }}>{band.key}</span>
                <span style={st.taskScoreLabel}>{band.label}</span>
                <span style={st.taskScoreValue}>{band.v.toFixed(1)}</span>
              </button>
            ))}
          </div>
        )}
        {result && (
          <div style={{ display: "flex", gap: 12, marginTop: 18 }}>
            {result === "failed"
              ? editingCorrections
                ? <button style={st.primary} onClick={submitCorrections}>Submit corrections →</button>
                : <button style={st.primary} onClick={() => setEditingCorrections(true)}>Update the Matrix →</button>
              : <button style={st.primary} onClick={onPass}>Let's continue to the main task →</button>}
            {result === "failed" && <button style={st.secondary} onClick={onBack}>← Back to practice</button>}
          </div>
        )}
      </div>
    </Shell>
  );
}

const LANGUAGE_PAIR_OPTIONS = [
  { value: "zh", label: "English–Mandarin Chinese" },
  { value: "nl", label: "English–Dutch" },
  { value: "de", label: "English–German" },
];

function Intro({ initialPage = 1, pid, selectedLanguage, onLanguageChange, onStart }) {
  const [page, setPage] = useState(initialPage);
  const [consented, setConsented] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const selectedExamples = PRACTICE_EXAMPLES_BY_LANGUAGE[selectedLanguage] || PRACTICE_EXAMPLES_BY_LANGUAGE.zh;
  const workedSource = selectedExamples[0];
  const workedMatrix = {
    cueL1: workedSource.cueL1,
    cueL2: workedSource.cueL2,
    cols: workedSource.cols,
    rows: workedSource.rows.map((row, r) => ({ ...row, vals: workedSource.answers[r] })),
  };
  const emptyWorkedMatrix = {
    ...workedMatrix,
    rows: workedMatrix.rows.map((row) => ({ ...row, vals: row.vals.map(() => null) })),
  };

  const goToPage = (nextPage) => {
    setPage(nextPage);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
    });
  };

  useLayoutEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [page]);

  if (page === 1) {
    return (
      <Shell>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 0 80px" }}>
        {/* <div style={st.kicker}>Cross-lingual Concept Equivalence Quantification</div> */}
        <h1 style={st.h1}>The study on bilingual perspectives on crosslingual semantic equivalence</h1>
        <p style={st.lead}>

        We are looking for bilingual speakers of English  paired with Mandarin Chinese, Dutch, German, or Rioplatense Spanish to participate in a study to explore what aspects of the meaning of a word are shared and unique between both languages.<br />
        </p>
        <p style={st.lead}>
         We’ll also ask you to answer a short set of questions about your background, language use and vocabulary. In the main task, you will be shown words in English and/or your native language. Your task is to judge the degree of semantic equivalence between a pair of cross-lingual words.  We provide instructions and practice examples, and a quick test example to help you understand the task before you begin.
         {/* This study helps us identify shared meanings as well as meanings that are unique to each language. */}
        {/* indicate whether the words are related, or similar in terms of meaning or translation across languages. */}

        {/* This study investigates the commonalities and differences in meaning among words across different languages. Two words in two languages that are very similar, or that can be translated into each other, do not always mean exactly the same thing. Hidden differences in attitude, scope, or connotation can quietly shape cross-cultural communication.  */}
        {/* This study helps us identify shared meanings as well as meanings that are unique to each language. */}
        </p>

        <h2 style={{ ...st.sectionTitle, borderTop: "none", paddingTop: 0 }}>What will you do?</h2>
        <p style={st.lead}>
          Your task is to assign scores to pairs of cross-lingual words according to how closely their meanings align.
          You will use four scores:
        </p>
        <div style={st.taskPreview}>
          <div><b>1.0 — Equivalent:</b> direct translations or completetly conceptual equivalent.</div>
          <div><b>0.8 — Strong alignment:</b> the same core meaning with a minor difference in nuance, scope, strength, formality, or grammatical form.</div>
          <div><b>0.5 — Moderate alignment:</b> substantial conceptual overlap, but one meaning is broader, narrower, a type of, or part of the other.</div>
          <div><b>0.0 — No alignment:</b> different concepts, including words connected only by topic, context, function, or causation.</div>
        </div>

        <div style={{ ...st.infoStrip, background: "#fbf6ea", border: "1px solid #ecdcb6", borderRadius: 10, padding: "14px 18px", fontSize: 14, lineHeight: 1.6 }}>
        <strong>Duration and Payment:</strong> This task will take approximately 30 minutes to complete, and you will receive a payment of $10 AUD upon successful completion. <br />
        <strong>Device Requirement:</strong> You must complete the study on a computer using the <strong>Chrome browser</strong>. Please do not use mobile devices or tablets.
        </div>

        {!pid && <p style={{ fontSize: 13, color: "#b9532f", marginTop: 18 }}>Heads up: no Prolific ID detected in the link. If you arrived from Prolific, please use the study link rather than a direct URL.</p>}

        <label style={st.consentRow}>
        <input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} style={st.consentCheckbox} />
        <span>
          I have read and agree to the{" "}
          <button type="button" style={st.consentLink} onClick={() => setShowConsent(true)}>consent form</button>. By checking the "Continue" button, I confirm that I am at least 18 years old and that I consent to participate in this study.
        </span>
        </label>

        <button
        style={{ ...st.primary, marginTop: 16, fontSize: 16, padding: "14px 28px", ...(consented ? {} : st.primaryDisabled) }}
        disabled={!consented}
        onClick={() => goToPage("language")}
        >
        Continue →
        </button>
      </div>
      {showConsent && <ConsentModal onClose={() => setShowConsent(false)} />}
      </Shell>
    );
  }

  if (page === "language") {
    return (
      <Shell>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 0 80px" }}>
          <div style={st.kicker}>Study language</div>
          <h1 style={st.h1}>Which language pair would you like to participate in?</h1>
          <p style={st.lead}>
            Choose the pair in which you are bilingual. Your examples, practice, test, and annotation matrices will
            use this language pair.
          </p>
          <div style={st.languagePairChoices}>
            {LANGUAGE_PAIR_OPTIONS.map((option) => (
              <label
                key={option.value}
                style={{
                  ...st.languagePairChoice,
                  ...(selectedLanguage === option.value ? st.languagePairChoiceSelected : {}),
                }}
              >
                <input
                  type="radio"
                  name="languagePair"
                  checked={selectedLanguage === option.value}
                  onChange={() => onLanguageChange(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
            <button style={st.secondary} onClick={() => goToPage(1)}>← Back</button>
            <button
              style={{ ...st.primary, ...(selectedLanguage ? {} : st.primaryDisabled) }}
              disabled={!selectedLanguage}
              onClick={() => goToPage(2)}
            >
              Continue →
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  if (page === 2) {
    return (
      <Demographics
        onBack={() => goToPage("language")}
        onSubmit={(answers) => { saveDemographics({ pid, answers }); goToPage(3); }}
      />
    );
  }

  if (page === 4) {
    return (
      <Practice
        examples={PRACTICE_EXAMPLES_BY_LANGUAGE[selectedLanguage]}
        onBack={() => goToPage(3)}
        onComplete={() => goToPage(5)}
      />
    );
  }

  if (page === 5) {
    return (
      <QualificationTest
        example={TEST_EXAMPLES_BY_LANGUAGE[selectedLanguage]}
        onBack={() => goToPage(4)}
        onPass={onStart}
      />
    );
  }

  return (
    <Shell>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 0 80px" }}>
        <div style={st.kicker}>Instructions and worked example</div>
        <h1 style={st.h1}>Task Instruction: How to judge conceptual equivalence?</h1>
        <p style={st.lead}>
          You will be given two cue words—one per language—and their association lists. The first word in each list is the cue itself. Treat the cue–cue pair as the anchor, then judge every association pair in the meaning context
          established by that cue pair.
        </p>

        <h2 style={{ ...st.sectionTitle, borderTop: "none", paddingTop: 0 }}>Instruction for the four scoring levels</h2>
        <div style={{ ...st.infoStrip, margin: "8px 0 14px" }}>
          You do not need to memorise these definitions. A scoring guide will remain available for reference during the annotation task.
        </div>
        {INSTRUCTION_SECTIONS.map((section) => {
          const band = bandOf(section.score);
          return (
            <div key={section.score} style={st.instructionBand}>
              <div style={{ ...st.rubricSwatch, background: band.c, color: band.ink }}>
                {section.score.toFixed(1)}
              </div>
              <div>
                <div style={st.rubricLabel}>{section.title}</div>
                <p style={{ ...st.rubricText, margin: "3px 0 6px" }}>{section.summary}</p>
                <InstructionLists section={section} large />
              </div>
            </div>
          );
        })}

        <h2 style={{ ...st.sectionTitle, borderTop: "none", paddingTop: 0 }}>Scoring discipline</h2>
        <ul style={{ ...st.lead, paddingLeft: 20 }}>
          {SCORING_DISCIPLINE.map((rule) => <li key={rule} style={{ marginBottom: 7 }}>{rule}</li>)}
        </ul>

        <h2 style={st.sectionTitle}>Example of the annotation UI</h2>
        <p style={st.lead}>
          On screen, you'll be given a cue pair — here, <b style={{ fontFamily: FONT_CJK }}>{workedSource.cueL1.w}</b> ↔ <b>{workedSource.cueL2.w}</b>,
          as shown in the top-left corner of the matrix. The row2 and column 2 (in red color) are the cue words themselves.
          From the third row and third column onward are the <b>associations</b> for each cue word: columns are associations in English, rows are associations in the other language. The matrix starts empty, like this:
        </p>

        <ExampleMatrixTable matrix={emptyWorkedMatrix} highlightCorner />

        <h2 style={st.sectionTitle}>Your task</h2>
        <ol style={{ ...st.lead, paddingLeft: 20, margin: "0 0 22px" }}>
          <li style={{ marginBottom: 10 }}>
            Compare the conceptual equivalence of the <b>cue–cue pair</b> to fill the top-left cell by assigning a score of
            <b> 1 / 0.8 / 0.5 / 0</b> based on the definitions on the previous page.
          </li>
          <li>
            Then compare each cross-lingual pair of associations for every remaining cell, and fill in a score the
            same way. Only click cells with a real relationship; anything left blank is saved as 0. You will be shown the matrix row and by row, click the "Next row" (or use keybord `enter') button to advance. You can also use the keyboard: <kbd>1</kbd>–<kbd>4</kbd> to mark, <kbd>←</kbd><kbd>→</kbd> to move, and <kbd>Enter</kbd> to advance.
          </li>
        </ol>

        <h2 style={st.sectionTitle}>Example annotation output</h2>
        <p style={{ ...st.lead, fontSize: 14 }}>Once scored, the same matrix looks like this:</p>

        <ExampleMatrixTable matrix={workedMatrix} highlightCorner />

        <p style={{ ...st.lead, fontSize: 14 }}>
          The top-left cell (<b>{workedSource.cueL1.w} × {workedSource.cueL2.w}</b>, scored {workedSource.answers[0][0].toFixed(1)}) is the cue-cue anchor — it represents the direct
          cross-lingual concept link that gives context to every other cell in the grid.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
          <button style={{ ...st.primary, background: "#fff", color: "#26292e", border: "1px solid #d8d4ca" }} onClick={() => goToPage(1)}>← Back</button>
          <button style={{ ...st.primary, fontSize: 16, padding: "14px 28px" }} onClick={() => goToPage(4)}>Continue to practice →</button>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children, wide }) {
  return (
    <div style={st.page}>
      <style>{`
        * { box-sizing: border-box; }
        html, body { margin: 0; overflow-anchor: none; }
        button { cursor: pointer; font-family: inherit; }
        button:focus-visible { outline: 3px solid #26292e; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce){ * { transition: none !important; scroll-behavior: auto !important; } }
      `}</style>
      <div style={{ ...st.frame, maxWidth: wide ? 1080 : 880 }}>{children}</div>
    </div>
  );
}

const st = {
  page: { minHeight: "100vh", background: "#f3f1ec", color: "#26292e", fontFamily: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`, padding: "0 20px" },
  frame: { margin: "0 auto", padding: "24px 0 60px" },
  sr: { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" },
  warn: { background: "#fbe7e0", border: "1px solid #e6b9a6", color: "#8a3a1c", borderRadius: 10, padding: "8px 14px", fontSize: 13, marginBottom: 12 },
  kicker: { fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: "#8a8578", fontWeight: 700, marginBottom: 10 },
  h1: { fontSize: 34, lineHeight: 1.1, margin: "0 0 14px", fontWeight: 800, letterSpacing: "-.02em" },
  cuePairTitle: { display: "grid", gridTemplateColumns: "max-content 44px max-content", alignItems: "center", width: "fit-content", margin: "0 0 8px", fontSize: 34, lineHeight: 1.05, fontWeight: 800, letterSpacing: "-.02em" },
  cuePairWord: { display: "block" },
  cuePairLanguage: { display: "block", marginTop: 6, color: "#6b727c", fontSize: 13, fontWeight: 800, letterSpacing: ".08em", lineHeight: 1.2, textTransform: "uppercase" },
  cuePairArrow: { alignSelf: "start", paddingTop: 2, textAlign: "center", color: "#4b515a" },
  axisStatement: { margin: "0 0 18px", color: "#4b515a", fontSize: 14, fontWeight: 700 },
  lead: { fontSize: 16, lineHeight: 1.6, color: "#4b515a", margin: "0 0 22px" },
  sectionTitle: { fontSize: 19, color: "#26292e", fontWeight: 800, margin: "30px 0 4px", paddingTop: 18, borderTop: "1px solid #e3e0d8" },
  infoStrip: { background: "#f7f5f0", borderRadius: 10, padding: "10px 18px", fontSize: 14, fontWeight: 400, color: "#000", margin: "0 0 22px" },
  infoLabel: { display: "block", fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "#8a8578", fontWeight: 700, marginBottom: 2 },

  instruction: { background: "#eaf2f3", color: "#33434a", border: "1px solid #c9dadd", borderRadius: 12, padding: "14px 18px", fontSize: 15, lineHeight: 1.55, marginBottom: 16 },
  instructionLabel: { display: "block", fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "#58717a", fontWeight: 800, marginBottom: 6 },
  taskPreview: { display: "grid", gap: 8, background: "#fff", border: "1px solid #e3e0d8", borderRadius: 12, padding: "15px 17px", margin: "-8px 0 24px", color: "#4b515a", fontSize: 14, lineHeight: 1.5 },
  referenceGuide: { background: "#fff", border: "1px solid #d8d4ca", borderRadius: 10, padding: "11px 14px", marginBottom: 16, color: "#4b515a", fontSize: 13.5 },
  referenceSummary: { color: "#26292e", fontWeight: 800, cursor: "pointer" },
  referenceRow: { display: "grid", gridTemplateColumns: "42px 1fr", gap: 10, alignItems: "start", marginBottom: 9, lineHeight: 1.45 },
  referenceScore: { display: "grid", placeItems: "center", minHeight: 26, borderRadius: 6, fontSize: 12, fontWeight: 800 },

  taskToolbar: { position: "sticky", top: 0, zIndex: 30, display: "grid", gridTemplateColumns: "minmax(220px,1fr) minmax(220px,320px) minmax(160px,1fr)", alignItems: "center", gap: 24, background: "rgba(255,255,255,.98)", border: "1px solid #e3e0d8", borderRadius: 12, padding: "14px 16px", marginBottom: 14, boxShadow: "0 5px 18px rgba(38,41,46,.08)" },
  taskCuePair: { display: "grid", gridTemplateColumns: "max-content 34px max-content", alignItems: "start", width: "fit-content" },
  taskCueWord: { display: "block", fontSize: 22, lineHeight: 1.05 },
  taskCueLanguage: { display: "block", marginTop: 4, color: "#6b727c", fontSize: 10.5, lineHeight: 1.2 },
  taskCueArrow: { paddingTop: 2, color: "#4b515a", fontSize: 20, textAlign: "center" },
  taskProgress: { minWidth: 0 },
  taskProgressText: { display: "block", color: "#26292e", fontSize: 13, fontWeight: 700, marginBottom: 8 },
  taskProgressTrack: { height: 6, overflow: "hidden", background: "#eceae4", borderRadius: 99 },
  taskProgressFill: { height: "100%", background: "#176b68", borderRadius: 99, transition: "width .3s ease" },
  taskGuide: { position: "relative", justifySelf: "end", color: "#176b68" },
  taskGuideSummary: { listStyle: "none", cursor: "pointer", fontSize: 13, fontWeight: 800, whiteSpace: "nowrap" },
  taskGuideBody: { position: "absolute", zIndex: 20, top: 30, right: 0, width: 460, maxHeight: "70vh", overflowY: "auto", background: "#fff", color: "#4b515a", border: "1px solid #d8d4ca", borderRadius: 12, padding: 18, boxShadow: "0 12px 32px rgba(38,41,46,.16)" },
  taskPrompt: { margin: "0 0 12px", color: "#5b636e", fontSize: 13 },
  taskGridScroll: { maxHeight: "calc(100vh - 285px)", overflow: "auto", overscrollBehavior: "contain" },
  taskAxisHead: { position: "sticky", top: 0, left: 0, zIndex: 8, padding: "12px 14px", background: "#f7f8f6", color: "#26292e", borderRight: "1px solid #e3e0d8", borderBottom: "1px solid #e3e0d8", textAlign: "left", fontSize: 13, fontWeight: 700 },
  taskAssociationHead: { position: "sticky", top: 0, zIndex: 6, height: 34, padding: "7px 10px", background: "#fff", color: "#26292e", borderBottom: "1px solid #e3e0d8", fontSize: 13, fontWeight: 700, textAlign: "center" },
  taskColHead: { position: "sticky", top: 34, zIndex: 5 },
  taskCell: { width: 78, minWidth: 78, height: 70, textAlign: "center", fontSize: 15, fontWeight: 800, borderBottom: "1px solid #e7e4dc", borderRight: "1px solid #e7e4dc", transition: "background .1s, box-shadow .1s", userSelect: "none", background: "#fff" },
  taskBottomBar: { position: "sticky", bottom: 0, zIndex: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", background: "rgba(255,255,255,.97)", border: "1px solid #e3e0d8", borderRadius: 12, padding: "12px 14px", boxShadow: "0 -6px 20px rgba(38,41,46,.07)" },
  taskSaveStatus: { color: "#176b68", fontSize: 14, fontWeight: 800, whiteSpace: "nowrap" },
  taskScoreButtons: { display: "grid", gridTemplateColumns: "repeat(4, minmax(82px,1fr))", gap: 8 },
  taskScoreButton: { display: "grid", gridTemplateColumns: "24px 1fr", columnGap: 7, rowGap: 2, alignItems: "center", minWidth: 100, background: "#fff", border: "1.5px solid", borderRadius: 7, padding: "9px 11px", textAlign: "left" },
  taskScoreKey: { fontSize: 17, lineHeight: 1, fontWeight: 800 },
  taskScoreLabel: { color: "#26292e", fontSize: 13, fontWeight: 750, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  taskScoreValue: { gridColumn: "1 / -1", color: "#26292e", fontSize: 13, lineHeight: 1.2, textAlign: "center" },
  taskNextButton: { background: "#176b68", minHeight: 52, padding: "11px 20px" },

  pairTopBar: { position: "sticky", top: 0, zIndex: 30, display: "grid", gridTemplateColumns: "1fr minmax(260px,380px) 1fr", alignItems: "center", gap: 24, background: "rgba(255,255,255,.98)", borderBottom: "1px solid #e3e0d8", padding: "12px 0 14px", marginBottom: 18 },
  pairMatrixCount: { fontSize: 14, color: "#26292e" },
  pairCellProgress: { display: "grid", gap: 7, textAlign: "center", fontSize: 14, fontWeight: 700 },
  pairGuideSummary: { listStyle: "none", cursor: "pointer", color: "#176b68", border: "1px solid #58717a", borderRadius: 7, padding: "9px 14px", fontSize: 14, fontWeight: 800, whiteSpace: "nowrap" },
  pairPage: { maxWidth: 760, margin: "0 auto", textAlign: "center" },
  pairCueLabel: { color: "#4b515a", fontSize: 14, marginBottom: 8 },
  pairCuePair: { display: "grid", gridTemplateColumns: "minmax(150px,max-content) 54px minmax(150px,max-content)", alignItems: "start", justifyContent: "center", marginBottom: 10 },
  pairCueWord: { display: "block", fontSize: 30, lineHeight: 1.1 },
  pairLanguage: { display: "block", marginTop: 6, color: "#5b636e", fontSize: 13 },
  pairArrow: { paddingTop: 5, color: "#5b636e", fontSize: 26 },
  pairOverviewLink: { background: "none", border: "none", padding: 3, color: "#176b68", fontSize: 13, fontWeight: 700, marginBottom: 16 },
  pairQuestionCard: { background: "#fff", border: "1px solid #d8d4ca", borderRadius: 9, padding: "18px 24px 14px", marginBottom: 14 },
  pairQuestionTitle: { margin: "0 0 15px", fontSize: 21, lineHeight: 1.25 },
  pairAssociationGrid: { display: "grid", gridTemplateColumns: "1fr 72px 1fr", alignItems: "center" },
  pairAssociationCard: { display: "grid", alignContent: "center", minHeight: 118, background: "#fff", border: "1px solid #d8d4ca", borderRadius: 8, padding: "14px 18px" },
  pairAssociationLanguage: { color: "#5b636e", fontSize: 13, marginBottom: 12 },
  pairAssociationWord: { fontSize: 38, lineHeight: 1.05 },
  pairAssociationArrow: { color: "#5b636e", fontSize: 34 },
  pairQuestionHint: { margin: "14px 0 0", color: "#4b515a", fontSize: 13 },
  pairKeyHint: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#26292e", fontSize: 13, marginBottom: 9 },
  pairKbd: { display: "inline-grid", placeItems: "center", width: 34, height: 32, background: "#fff", border: "1px solid #c7c7c2", borderRadius: 5, boxShadow: "0 2px 2px rgba(38,41,46,.2)", fontSize: 17, fontWeight: 800 },
  pairScoreList: { display: "grid", gap: 6, marginBottom: 18 },
  pairScoreOption: { display: "grid", gridTemplateColumns: "105px 58px 190px 1fr", alignItems: "center", gap: 10, minHeight: 50, background: "#fff", border: "1.5px solid", borderRadius: 7, padding: "7px 10px", textAlign: "left" },
  pairPress: { justifySelf: "start", minWidth: 90, background: "#fff", border: "1px solid #c7c7c2", borderRadius: 5, padding: "6px 9px", boxShadow: "0 2px 2px rgba(38,41,46,.18)", fontSize: 13 },
  pairPressKey: { color: "#26292e", fontSize: 17, fontWeight: 800 },
  pairScoreNumber: { fontSize: 20 },
  pairScoreName: { fontSize: 14 },
  pairScoreDescription: { color: "#26292e", fontSize: 12.5 },
  pairFooter: { position: "sticky", bottom: 0, zIndex: 30, display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 20, background: "rgba(255,255,255,.98)", borderTop: "1px solid #e3e0d8", padding: "13px 0 4px" },
  pairPrevious: { justifySelf: "start", background: "#fff", color: "#176b68", border: "1px solid #58717a", borderRadius: 7, padding: "11px 16px", fontSize: 13, fontWeight: 700 },
  pairFooterStatus: { display: "grid", gap: 5, color: "#4b515a", fontSize: 12.5, textAlign: "center" },
  pairNext: { justifySelf: "end", background: "#176b68", color: "#fff", border: "none", borderRadius: 7, padding: "13px 20px", fontSize: 14, fontWeight: 800 },
  matrixOverlay: { position: "fixed", inset: 0, zIndex: 100, background: "#f7f6f2", overflow: "hidden" },
  matrixView: { display: "grid", gridTemplateRows: "auto auto minmax(0,1fr) auto", width: "100%", height: "100vh", padding: "0 18px" },
  matrixViewToolbar: { display: "grid", gridTemplateColumns: "minmax(240px,1fr) minmax(260px,360px) minmax(280px,1fr)", alignItems: "center", gap: 24, background: "#fff", borderBottom: "1px solid #e3e0d8", padding: "13px 10px" },
  matrixViewActions: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 22, fontSize: 13 },
  matrixViewGrid: { minHeight: 0, maxHeight: "none", marginBottom: 0, borderRadius: 7, overflow: "auto" },
  matrixViewFooter: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, background: "#fff", borderTop: "1px solid #e3e0d8", padding: "12px 10px" },

  progWrap: { display: "flex", alignItems: "center", gap: 12, marginBottom: 14 },
  progBar: { flex: 1, height: 6, background: "#e3e0d8", borderRadius: 99, overflow: "hidden" },
  progFill: { height: "100%", background: "#26292e", transition: "width .3s ease" },
  progTxt: { fontSize: 12, color: "#8a8578", fontWeight: 700, whiteSpace: "nowrap" },

  gate: { background: "#fbf6ea", border: "1px solid #ecdcb6", borderRadius: 10, padding: "10px 16px", fontSize: 14, lineHeight: 1.5, color: "#4b515a", marginBottom: 16 },

  gridScroll: { overflowX: "auto", border: "1px solid #e3e0d8", borderRadius: 14, background: "#fff", marginBottom: 18 },
  table: { borderCollapse: "separate", borderSpacing: 0, width: "auto", minWidth: "100%" },
  corner: { position: "sticky", left: 0, zIndex: 3, background: "#dce7e9", color: "#40545b", padding: "8px 12px", borderTopLeftRadius: 14, borderRight: "2px solid #c9dadd", borderBottom: "2px solid #c9dadd", fontSize: 15, textAlign: "center", verticalAlign: "middle", width: 140, minWidth: 140 },
  colHead: { width: 62, padding: "10px 8px", fontSize: 13, fontWeight: 700, color: "#4b515a", background: "#faf8f3", borderBottom: "2px solid #e3e0d8", whiteSpace: "nowrap", minWidth: 62 },
  colHeadCue: { background: "#fbe4e0", color: "#a3341c" },
  rowHead: { position: "sticky", left: 0, zIndex: 2, background: "#eef4ee", padding: "8px 12px", textAlign: "left", verticalAlign: "middle", borderRight: "2px solid #e3e0d8", width: 140, minWidth: 140 },
  rowHeadCue: { background: "#fbe4e0" },
  rowHeadGloss: { display: "block", fontSize: 11, color: "#8a8578", fontWeight: 400 },
  headActive: { background: "#e7e2d6", color: "#26292e" },
  cell: { width: 62, height: 46, textAlign: "center", fontSize: 15, fontWeight: 800, borderBottom: "1px solid #eee7da", borderRight: "1px solid #eee7da", transition: "background .1s", userSelect: "none", background: "#fcfbe9" },
  cellZero: { background: "#fff", color: "#cdd2d8" },
  cellCursor: { boxShadow: "inset 0 0 0 3px #26292e" },
  cellHover: { boxShadow: "inset 0 0 0 2px #9a9488" },

  pad: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 16 },
  padBtn: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4, textAlign: "left", background: "#fff", border: "2px solid", borderRadius: 12, padding: "12px 14px", minHeight: 112 },
  padKey: { width: 22, height: 22, borderRadius: 6, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 800 },
  padVal: { fontSize: 20, fontWeight: 800, lineHeight: 1 },
  padLabel: { fontSize: 13, fontWeight: 700 },
  padBlurb: { fontSize: 11.5, color: "#6b727c", lineHeight: 1.4 },

  nav: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  hint: { fontSize: 12, color: "#8a8578" },
  kbd: { display: "inline-block", padding: "1px 6px", margin: "0 1px", background: "#f3f1ec", border: "1px solid #d8d4ca", borderRadius: 5, fontSize: 11, fontWeight: 700 },
  primary: { background: "#26292e", color: "#fff", border: "none", borderRadius: 10, padding: "11px 20px", fontSize: 14, fontWeight: 700 },
  secondary: { background: "#fff", color: "#26292e", border: "1px solid #d8d4ca", borderRadius: 10, padding: "11px 20px", fontSize: 14, fontWeight: 700 },
  primaryDisabled: { background: "#c4c8cf", cursor: "not-allowed" },

  consentRow: { display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14.5, color: "#4b515a", marginTop: 26, lineHeight: 1.5 },
  consentCheckbox: { width: 18, height: 18, marginTop: 2, flexShrink: 0 },
  consentLink: { background: "none", border: "none", padding: 0, margin: 0, font: "inherit", color: "#26292e", fontWeight: 700, textDecoration: "underline", cursor: "pointer" },

  modalOverlay: { position: "fixed", inset: 0, background: "rgba(38,41,46,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 100 },
  modalCard: { background: "#fff", borderRadius: 16, maxWidth: 640, width: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden" },
  modalHead: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "22px 24px 16px", borderBottom: "1px solid #e3e0d8" },
  modalClose: { background: "#f3f1ec", border: "none", borderRadius: 8, width: 32, height: 32, fontSize: 15, color: "#4b515a", flexShrink: 0 },
  modalBody: { padding: "20px 24px 26px", overflowY: "auto" },

  gateBig: { background: "#26292e", color: "#f3f1ec", borderRadius: 14, padding: "20px 22px", fontSize: 15.5, lineHeight: 1.6, margin: "0 0 30px" },
  gateBigTitle: { fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: "#a9a596", fontWeight: 700, marginBottom: 8 },
  rubricRow: { display: "grid", gridTemplateColumns: "64px 1fr", gap: 16, padding: "16px 0", borderTop: "1px solid #e3e0d8", alignItems: "start" },
  rubricSwatch: { height: 48, borderRadius: 10, display: "grid", placeItems: "center", fontSize: 18, fontWeight: 800 },
  rubricLabel: { fontSize: 16, fontWeight: 800, marginBottom: 3 },
  rubricText: { fontSize: 14, color: "#4b515a", lineHeight: 1.5 },
  rubricEg: { fontSize: 13, color: "#8a8578", marginTop: 5, fontStyle: "italic" },
  instructionBand: { display: "grid", gridTemplateColumns: "54px 1fr", gap: 14, alignItems: "start", padding: "14px 0", borderBottom: "1px solid #e9e5dc" },
  practiceCard: { background: "#fff", border: "1px solid #e3e0d8", borderRadius: 14, padding: "24px", boxShadow: "0 4px 18px rgba(38,41,46,.05)" },
  practicePair: { display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 22, alignItems: "center", textAlign: "center", marginBottom: 24 },
  practiceWord: { fontSize: 28, fontWeight: 800, color: "#26292e" },
  practiceGloss: { fontSize: 13, color: "#6b727c", marginTop: 4 },
  practiceArrow: { fontSize: 24, color: "#8a8578" },
  practiceChoices: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 },
  practiceChoice: { display: "flex", alignItems: "center", gap: 10, background: "#fff", color: "#26292e", border: "2px solid", borderRadius: 10, padding: "11px 13px", fontSize: 14, textAlign: "left", cursor: "pointer" },
  practiceFeedback: { marginTop: 16, borderRadius: 10, padding: "14px 16px", fontSize: 14.5, lineHeight: 1.55 },
  practiceFeedbackCorrect: { background: "#eef7f0", border: "1px solid #b9d9c1", color: "#245b35" },
  practiceFeedbackError: { background: "#fbf0eb", border: "1px solid #e6c0ae", color: "#873b20" },
  rowFeedbackPanel: { background: "#fff", border: "1px solid #d8d4ca", borderRadius: 12, padding: 16, marginTop: 16 },
  practiceCorrection: { background: "#fff", border: "1px solid #e3e0d8", borderRadius: 10, padding: "12px 14px", marginTop: 10, color: "#4b515a", fontSize: 14, lineHeight: 1.5 },
  practiceCorrectionCorrect: { background: "#f5faf6", borderColor: "#b9d9c1" },
  practiceCorrectionError: { background: "#fff7f3", borderColor: "#e6c0ae" },
  codeBox: { background: "#eef4ee", border: "1px solid #cfe0cf", borderRadius: 10, padding: "14px 18px", fontSize: 16, margin: "16px 0" },

  fieldGroup: { marginBottom: 22 },
  fieldLabel: { display: "block", fontSize: 14.5, fontWeight: 700, color: "#26292e", marginBottom: 8 },
  fieldHint: { display: "block", fontSize: 12.5, fontWeight: 400, color: "#8a8578", marginTop: 2 },
  fieldInput: { width: "100%", maxWidth: 360, padding: "10px 12px", fontSize: 14.5, border: "1px solid #d8d4ca", borderRadius: 8, background: "#fff", color: "#26292e", font: "inherit" },
  fieldInputError: { borderColor: "#c0684a" },
  fieldSelect: { width: "100%", maxWidth: 360, padding: "10px 12px", fontSize: 14.5, border: "1px solid #d8d4ca", borderRadius: 8, background: "#fff", color: "#26292e", font: "inherit" },
  optionRow: { display: "flex", alignItems: "flex-start", gap: 8, fontSize: 14.5, color: "#4b515a", marginBottom: 8, lineHeight: 1.4 },
  optionInput: { width: 16, height: 16, marginTop: 3, flexShrink: 0 },
  fieldError: { fontSize: 12.5, color: "#b9532f", marginTop: 6 },
  subFields: { marginTop: 6, marginLeft: 20, paddingLeft: 16, borderLeft: "2px solid #e3e0d8" },
  ratingRow: { display: "flex", flexWrap: "wrap", gap: 8 },
  ratingBtn: { width: 40, height: 40, borderRadius: 8, border: "1px solid #d8d4ca", background: "#fff", color: "#26292e", fontSize: 14.5, fontWeight: 700 },
  ratingBtnActive: { background: "#26292e", color: "#fff", borderColor: "#26292e" },
  languagePairChoices: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginBottom: 24 },
  languagePairChoice: { display: "flex", alignItems: "center", gap: 9, background: "#fff", border: "2px solid #d8d4ca", borderRadius: 10, padding: "13px 14px", color: "#4b515a", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  languagePairChoiceSelected: { borderColor: "#26292e", background: "#f7f5f0", color: "#26292e" },

  devNav: { position: "fixed", top: 12, right: 12, zIndex: 999, display: "flex", flexDirection: "column", gap: 4, background: "#1c1e22", border: "1px solid #3a3d43", borderRadius: 10, padding: "8px", boxShadow: "0 6px 20px rgba(0,0,0,.25)", maxWidth: 168 },
  devNavLabel: { fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#8a8578", fontWeight: 700, padding: "2px 6px 4px" },
  devNavBtn: { textAlign: "left", background: "transparent", color: "#d6d3c9", border: "none", borderRadius: 6, padding: "6px 8px", fontSize: 12.5, cursor: "pointer" },
  devNavBtnActive: { background: "#f3f1ec", color: "#1c1e22", fontWeight: 700 },
};
