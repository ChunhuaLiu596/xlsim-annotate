import { createClient } from "@supabase/supabase-js";

// These are injected at build time by Vite from .env / Vercel env vars.
// The anon key is PUBLIC by design — safety comes from the row-level
// security policy in supabase/schema.sql, NOT from hiding this key.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && anonKey ? createClient(url, anonKey) : null;

// True when the backend is configured. When false, the app still runs
// (useful for local UI work) but writes are skipped and logged.
export const backendReady = Boolean(supabase);
