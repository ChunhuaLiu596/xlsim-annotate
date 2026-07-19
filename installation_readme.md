# Access 
https://supabase.com/dashboard/project/jtswicehynrgmyifoqgd/editor/17724?schema=public 

# Supabase setup — step by step (dashboard UI)

This walks through connecting a fresh Supabase project to this app via the
web dashboard, and explains how the pieces wire together so you can debug
it yourself next time.

## 1. Create the project
1. Go to supabase.com and sign in.
2. **New project** → pick an org, name it, set a database password (save
   it, but you likely won't need it day-to-day — API keys are used instead),
   pick a region, **Create new project**. Takes ~1-2 min.

## 2. Run the schema
1. Left sidebar → **SQL Editor** → **New query**.
2. Paste the full contents of `supabase/schema.sql` → **Run**.
3. Verify: **Table Editor** should list `annotations` and `sessions`.

Re-running the whole script a second time will error on
`policy "..." already exists` — that's expected (tables/indexes use
`if not exists`, but `create policy` doesn't). It means the schema already
applied; no need to re-run unless you've changed it, in which case alter/drop
manually rather than re-running the file as-is.

## 3. Get your API keys
1. **Project Settings → API keys**.
2. Copy the **Project URL**. It's not always shown as its own field in newer
   dashboard versions — if not, it's always `https://<project-id>.supabase.co`,
   where `<project-id>` is shown on **Project Settings → General**.
3. Copy the **Publishable key** (`sb_publishable_...`) — this is the current
   name for what used to be called the `anon` key. Safe to expose in browser
   code; it's meant to be public.
4. Do **not** use the **Secret key** (`sb_secret_...`, formerly
   `service_role`) client-side — it bypasses row-level security entirely.

## 4. Wire it into the app
Create `.env.local` (copied from `.env.example`, already gitignored):
```
VITE_SUPABASE_URL=https://<project-id>.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
VITE_PROLIFIC_COMPLETION_URL=...
VITE_PROLIFIC_COMPLETION_CODE=
```

## 5. Run and test
```bash
npm install
npm run dev
```
Open the printed localhost URL with fake Prolific params to exercise the
real save path:
```
http://localhost:5173/?PROLIFIC_PID=test123&STUDY_ID=s&SESSION_ID=z
```
Score a row, finish, then check **Supabase → Table Editor → annotations**
for a new row.

---

# How the UI connects to Supabase (the mechanism)

Five links in the chain, browser click → Postgres row:

### 1. Credentials enter the app — `.env.local`
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```
Vite auto-loads this at dev/build time. Any var prefixed `VITE_` is exposed
to browser code via `import.meta.env.*` — that prefix is a Vite convention
marking "safe to ship to the client" (everything in a static site is public
anyway, so this isn't a secrecy boundary, just an opt-in one).

### 2. One shared client — `src/supabase.js`
```js
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && anonKey ? createClient(url, anonKey) : null;
export const backendReady = Boolean(supabase);
```
`createClient` (from `@supabase/supabase-js`) builds one object that knows
how to call your project's REST API. Every other file imports this same
instance. `backendReady` lets the rest of the app detect "no env vars set"
and fall back to preview mode (UI works, nothing saves).

### 3. Typed helper functions — `src/prolific.js`
The *only* file that calls `supabase.from(...)`. Four functions:
- `startSession` → `sessions` **upsert** — once, when the task screen mounts
- `saveCells` → `annotations` **insert** — once per committed row
- `finishSession` → `sessions` **update** — once, at the end
- `redirectToProlific` — no Supabase call, just navigates away afterward

Each function accepts camelCase JS objects (`rowWord`, `colWord` — matching
how the UI thinks about data) and translates them to the snake_case Postgres
column names (`row_word`, `col_word`) right before the `.insert()`/`.upsert()`
call. **This translation step is the most common bug source** — if a new
function skips it, or the mapping is wrong, Supabase throws
`Could not find the 'X' column of 'Y' in the schema cache` and the row
silently fails to save.

### 4. UI triggers the calls — `src/App.jsx`
React state (`scores`) holds what's currently on screen. `commitRow` reads
that state, shapes it into row objects, and calls `saveCells(rowCells)`.
The call is `await`-ed: advancing to the next row, and the final redirect to
Prolific, only happen after Supabase confirms the write ("save-before-redirect").

### 5. Supabase side — enforcement, not app logic
`supabase.from("annotations").insert(...)` becomes an HTTP POST to
`https://<project>.supabase.co/rest/v1/annotations`, authenticated by the
publishable/anon key. Supabase auto-generates this REST API from the table
schema — no server code needed. What you *did* write is
`supabase/schema.sql`: table shapes plus row-level security (RLS) policies
saying "anon may insert, may not select." Postgres enforces this on every
request no matter what the JS client asks for — that's the actual security
boundary, not the key being secret.

## Debugging checklist next time something doesn't save
1. Open browser DevTools → **Network** tab, filter by `supabase`.
2. Trigger the action (score a row, advance, finish).
3. Find the POST/PATCH to `.../rest/v1/<table>` — inspect the request body.
4. Check the response:
   - **201** — inserted fine, look elsewhere for the bug.
   - **400 / column not found** — request body keys don't match Postgres
     column names (snake_case). Fix the mapping in `src/prolific.js`.
   - **401 / 403 / RLS violation** — the policy in `schema.sql` doesn't
     allow this operation for the `anon` role. Check the `create policy`
     statements.
5. Cross-check against **Supabase → Table Editor** to confirm what actually
   landed vs. what you expected.


## Put data in batch

cd /Users/chunhua1/Downloads/swow-crosslingual-align/xlsim-annotate
python3 scripts/csv_to_cue_pairs.py data/debug_pairs_cmn.csv > /tmp/cue_pairs.json
export SUPABASE_URL=https://jtswicehynrgmyifoqgd.supabase.co
export SUPABASE_SERVICE_ROLE_KEY="sb_secret_..."   # set locally in your shell, never commit the real value
node scripts/load_cue_pairs.js /tmp/cue_pairs.json 3

upserted 15 cue pairs (target_labels=3)