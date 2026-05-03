import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error("Mangler Supabase env-variabler. Sjekk .env.local og Vercel-settings.");
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});
