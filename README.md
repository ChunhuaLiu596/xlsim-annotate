# XLSim — cross-lingual association annotation (Vite + Supabase + Prolific)

Row-at-a-time matrix annotation for cross-lingual semantic equivalence.
Progressive row reveal, blanks default to 0, keyboard scoring, gold-cell QC,
and Prolific PID capture with save-before-redirect.

## Stack
- **Front end:** Vite + React (static build) → deploy to **Vercel**.
- **Database:** **Supabase** (hosted Postgres). No backend server to run.
- **Recruitment:** **Prolific** external-study link.

---

## 1. Local run
```bash
npm install
cp .env.example .env.local     # fill in Supabase + Prolific values (or leave blank to preview UI)
npm run dev
```
Open the printed localhost URL. With no env vars set, the app runs in
**preview mode** (a banner shows; nothing saves) so you can work on the UI.

Test the Prolific flow locally by appending a fake PID:
`http://localhost:5173/?PROLIFIC_PID=test123&STUDY_ID=s&SESSION_ID=z`

## 2. Supabase (database)
1. Create a project at supabase.com.
2. **SQL editor → New query →** paste `supabase/schema.sql` → **Run**.
   This creates the `annotations` + `sessions` tables and — critically —
   the **row-level security** policy (anon can insert, cannot read others'
   rows). Do not skip it.
3. **Project Settings → API →** copy the **Project URL** and **anon public**
   key into `.env.local` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).

You read/export data in the dashboard (**Table editor** or SQL), which uses
the service role and bypasses RLS.

## 3. Vercel (hosting)
1. Push this folder to a GitHub repo.
2. Import it in Vercel → framework auto-detects **Vite**.
3. **Settings → Environment Variables →** add the same four `VITE_…` vars
   from `.env.example`.
4. Deploy. You get `https://your-study.vercel.app` (HTTPS, required by Prolific).

## 4. Prolific (recruitment)
1. Create a study → **"I'll use an external study link."**
2. Study URL:
   `https://your-study.vercel.app/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}`
3. **Study completion → "I'll redirect them using a URL."** Copy the
   completion/redirect URL Prolific gives you into `VITE_PROLIFIC_COMPLETION_URL`
   (in Vercel env vars) and redeploy. (Optionally also set a code as fallback.)
4. **Preview** the study — Prolific fills a real 24-char PID into the link;
   check a row lands in the Supabase `annotations` table, and that finishing
   redirects back to Prolific.

**Save-before-redirect** is built in: the app only redirects after the final
write confirms. Collect the PID at the start (it's read on load), so dropouts
are still identifiable.

## 5. Load pilot and production cue pairs

Both datasets use the same `cue_pairs` table and are isolated by
`dataset_batch`. Non-production IDs are prefixed automatically to prevent
collisions while preserving existing production IDs.

Load the pilot CSV:
```bash
python scripts/csv_to_cue_pairs.py data/debug_pairs_cmn.csv > pilot_cue_pairs.json
node scripts/load_cue_pairs.js pilot_cue_pairs.json 3 pilot
```

Load the production dataset using the JSON companion generated alongside
`data/cue_pairs_preview.csv`:
```bash
node scripts/load_cue_pairs.js data/cue_pairs_preview.json 3 production
```

Set `VITE_ANNOTATION_BATCH=pilot` for pilot collection and
`VITE_ANNOTATION_BATCH=production` for the scaled study, then rebuild or
redeploy. The UI and annotation workflow are identical for both batches.

## Data model
- `annotations`: one row per cell (`prolific_pid, cue_id, row_word, col_word,
  score, created_at`) — your IAA analysis table.
- `sessions`: one row per participant (`prolific_pid, started_at, finished_at,
  gold_pass, active_ms, completion_code`) — approve/reject + straight-liner checks.

## Notes / caveats
- The anon key is public (normal for Supabase). Security is the RLS policy,
  not key secrecy — verify no `select` policy exists for `anon`.
- Blank→0 makes all-zeros the lazy path; the gold cells are what catch it.
  Keep `maxGoldMisses: 0` unless you have a reason to loosen it.
- For multi-annotator overlap (IAA), assign the same cue pairs to N workers
  in Prolific; every judgment is keyed by PID so you can pivot per cell.
