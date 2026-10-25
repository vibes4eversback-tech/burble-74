import { createClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL ?? import.meta.env.SUPABASE_URL) as string;
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? import.meta.env.SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.SUPABASE_ANON_KEY) as string;

if (!url || !anonKey) {
  throw new Error('Supabase environment variables are missing. Connect the Supabase integration and restart the preview.');
}

export const SESSION_KEY = 'burble.session';

export interface Session {
  token: string;
  userId: string;
  nickname: string;
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null) {
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
}

// The token is read at request time so sign-in/out takes effect immediately.
let currentToken: string | null = loadSession()?.token ?? null;
export function setToken(t: string | null) {
  currentToken = t;
}

const headerFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  if (currentToken) headers.set('x-session-token', currentToken);
  return fetch(input, { ...init, headers });
};

export const supabase = createClient(url, anonKey, {
  global: { fetch: headerFetch },
  auth: { persistSession: false, autoRefreshToken: false },
});

export const MEDIA_BASE = `${url}/storage/v1/object/public/media/`;
