import { supabase, backendReady } from "./supabase.js";

/* ------------------------------------------------------------------ *
 * Prolific integration + data access.
 *
 * Prolific redirects participants to:
 *   https://your-study.vercel.app/?PROLIFIC_PID=xxxx&STUDY_ID=yyyy&SESSION_ID=zzzz
 * We read those params on load, key all data to PROLIFIC_PID, and at the
 * end redirect back to the Prolific completion URL — but ONLY after the
 * final write confirms (save-before-redirect).
 * ------------------------------------------------------------------ */

export function getProlificParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    pid: p.get("PROLIFIC_PID") || "",
    studyId: p.get("STUDY_ID") || "",
    sessionId: p.get("SESSION_ID") || "",
  };
}

// Set these two after you create the study in Prolific.
// COMPLETION_URL: Prolific "I'll redirect them using a URL" → paste here.
// COMPLETION_CODE: shown on-screen as a fallback if redirect fails.
export const COMPLETION_URL = import.meta.env.VITE_PROLIFIC_COMPLETION_URL || "";
export const COMPLETION_CODE = import.meta.env.VITE_PROLIFIC_COMPLETION_CODE || "";
export const ANNOTATION_BATCH = import.meta.env.VITE_ANNOTATION_BATCH || "pilot";

// Fetch this participant's assigned cue pairs, assigning them on first
// call. Maps snake_case DB columns back to the camelCase shape the UI
// (and the old static taskData.js) expects.
export async function fetchAssignedPairs(pid, n = 5, language = null, batch = ANNOTATION_BATCH) {
  if (!backendReady) return { ok: true, offline: true, pairs: [] };
  const { data, error } = await supabase.rpc("assign_cue_pairs", {
    p_pid: pid,
    n,
    p_language: language,
    p_dataset_batch: batch,
  });
  if (error) return { ok: false, error, pairs: [] };
  const pairs = (data || []).map((row) => ({
    id: row.id,
    cueL1: row.cue_l1,
    cueL2: row.cue_l2,
    cols: row.cols,
    rows: row.rows,
    gold: row.gold || [],
  }));
  return { ok: true, pairs };
}

export async function startSession({ pid, studyId, sessionId }) {
  if (!backendReady) return { ok: true, offline: true };
  const { error } = await supabase.from("sessions").upsert(
    {
      prolific_pid: pid,
      study_id: studyId,
      session_id: sessionId,
      dataset_batch: ANNOTATION_BATCH,
      started_at: new Date().toISOString(),
    },
    { onConflict: "prolific_pid" }
  );
  return { ok: !error, error };
}

// Insert one cell's judgment. Called on every non-zero click AND for
// blank→0 defaults committed at row advance, so the analysis table is complete.
export async function saveCell({ pid, cueId, rowWord, colWord, score }) {
  if (!backendReady) return { ok: true, offline: true };
  const { error } = await supabase.from("annotations").insert({
    prolific_pid: pid,
    cue_id: cueId,
    row_word: rowWord,
    col_word: colWord,
    score,
  });
  return { ok: !error, error };
}

// Batch variant: commit a whole row's cells in one request (fewer round-trips).
export async function saveCells(rows) {
  if (!backendReady) return { ok: true, offline: true };
  if (rows.length === 0) return { ok: true };
  const { error } = await supabase.from("annotations").insert(
    rows.map(({ pid, cueId, rowWord, colWord, score }) => ({
      prolific_pid: pid,
      cue_id: cueId,
      row_word: rowWord,
      col_word: colWord,
      score,
    }))
  );
  return { ok: !error, error };
}

// Finalize: record finish time + QC, THEN return so caller can redirect.
export async function finishSession({ pid, goldPass, activeMs }) {
  if (!backendReady) return { ok: true, offline: true };
  const { error } = await supabase.from("sessions").update({
    finished_at: new Date().toISOString(),
    gold_pass: goldPass,
    active_ms: activeMs,
    completion_code: COMPLETION_CODE || null,
  }).eq("prolific_pid", pid);
  return { ok: !error, error };
}

export function redirectToProlific() {
  if (COMPLETION_URL) window.location.href = COMPLETION_URL;
}

// Save the one-time demographic questionnaire for this participant.
export async function saveDemographics({ pid, answers }) {
  if (!backendReady) return { ok: true, offline: true };
  const { error } = await supabase.from("demographics").upsert(
    { prolific_pid: pid, ...answers },
    { onConflict: "prolific_pid" }
  );
  return { ok: !error, error };
}

// Save the end-of-study feedback questionnaire for this participant.
export async function saveFeedback({ pid, answers }) {
  if (!backendReady) return { ok: true, offline: true };
  const { error } = await supabase.from("feedback").upsert(
    { prolific_pid: pid, ...answers },
    { onConflict: "prolific_pid" }
  );
  return { ok: !error, error };
}
