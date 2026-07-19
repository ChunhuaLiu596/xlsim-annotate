#!/usr/bin/env node
/*
 * Load cue pairs into Supabase, replacing the "paste into taskData.js" step.
 *
 * Input: the JSON array produced by npz_to_taskdata.py.
 * Uses the SERVICE ROLE key (bypasses RLS) — this is an admin/seeding
 * step you run locally, never something that ships to the browser.
 *
 * Usage:
 *   python scripts/npz_to_taskdata.py CMN-ENG.flow_matrices.npz > cue_pairs.json
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=sb_secret_... \
 *   node scripts/load_cue_pairs.js cue_pairs.json [targetLabels] [datasetBatch]
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const [, , jsonPath, targetLabelsArg, datasetBatchArg] = process.argv;
if (!jsonPath) {
  console.error("usage: node scripts/load_cue_pairs.js <cue_pairs.json> [targetLabels=3] [datasetBatch=pilot]");
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars first");
  process.exit(1);
}

const targetLabels = Number(targetLabelsArg) || 3;
const datasetBatch = datasetBatchArg || process.env.ANNOTATION_BATCH || "pilot";
const pairs = JSON.parse(readFileSync(jsonPath, "utf-8"));

const supabase = createClient(url, serviceKey);

const rows = pairs.map((p) => ({
  id: datasetBatch === "production" ? p.id : `${datasetBatch}:${p.id}`,
  cue_l1: p.cueL1,
  cue_l2: p.cueL2,
  cols: p.cols,
  rows: p.rows,
  gold: p.gold || [],
  target_labels: targetLabels,
  dataset_batch: datasetBatch,
}));

const { error, count } = await supabase
  .from("cue_pairs")
  .upsert(rows, { onConflict: "id", count: "exact" });

if (error) {
  console.error("upsert failed:", error.message);
  process.exit(1);
}
console.log(`upserted ${rows.length} cue pairs (batch=${datasetBatch}, target_labels=${targetLabels})`);
