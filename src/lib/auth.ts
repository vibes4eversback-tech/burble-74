import { supabase, saveSession, setToken, type Session } from './supabase';

type AuthResult = { token: string; user_id: string; nickname: string; error?: string };

export async function register(nickname: string, pin: string): Promise<Session> {
  const { data, error } = await supabase.rpc('register_account', { p_nickname: nickname, p_pin: pin });
  if (error) throw new Error(error.message);
  return finish(data as AuthResult);
}

export async function login(nickname: string, pin: string): Promise<Session> {
  const { data, error } = await supabase.rpc('login_account', { p_nickname: nickname, p_pin: pin });
  if (error) throw new Error(error.message);
  return finish(data as AuthResult);
}

export async function logout(): Promise<void> {
  await supabase.rpc('logout_account');
  setToken(null);
  saveSession(null);
}

function finish(r: AuthResult): Session {
  if (r.error || !r.token) throw new Error(r.error ?? 'Sign-in failed');
  const s: Session = { token: r.token, userId: r.user_id, nickname: r.nickname };
  setToken(s.token);
  saveSession(s);
  return s;
}
