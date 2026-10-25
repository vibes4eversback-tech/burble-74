import { useEffect, useState } from 'react';
import { login, logout, register } from './lib/auth';
import { loadSession, saveSession, setToken, type Session } from './lib/supabase';
import { applyTheme, loadTheme, THEMES, type ThemeId } from './lib/theme';
import { Shell } from './Shell';

export default function App() {
  const [session, setSession] = useState<Session | null>(() => {
    const s = loadSession();
    if (s) setToken(s.token);
    return s;
  });
  const [theme, setTheme] = useState<ThemeId>(loadTheme);

  useEffect(() => applyTheme(theme), [theme]);

  return (
    <>
      <div className="blob a" />
      <div className="blob b" />
      {session ? (
        <Shell
          session={session}
          theme={theme}
          onTheme={setTheme}
          onSignOut={async () => {
            await logout().catch(() => undefined);
            saveSession(null);
            setSession(null);
          }}
        />
      ) : (
        <AuthScreen onSession={setSession} />
      )}
    </>
  );
}

function AuthScreen({ onSession }: { onSession: (s: Session) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [nickname, setNickname] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[0-9]{4,6}$/.test(pin)) return setError('PIN must be 4 to 6 digits');
    setBusy(true);
    try {
      const s = mode === 'login' ? await login(nickname.trim(), pin) : await register(nickname.trim(), pin);
      onSession(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <form className="glass auth-card" onSubmit={submit}>
        <h1>Burble</h1>
        <p className="muted" style={{ margin: 0 }}>
          {mode === 'login' ? 'Welcome back. Sign in with your nickname and PIN.' : 'Pick a nickname and a 4–6 digit PIN. PINs are not recoverable.'}
        </p>
        <input className="input" placeholder="Nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} autoComplete="username" required />
        <input className="input" placeholder="PIN (4–6 digits)" inputMode="numeric" type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="current-password" required />
        {error && <div className="error">{error}</div>}
        <button className="btn primary" disabled={busy}>{mode === 'login' ? 'Sign in' : 'Create account'}</button>
        <button type="button" className="btn" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}
        </button>
        <div className="theme-row" aria-label="Theme">
          {THEMES.map((t) => (
            <button key={t.id} type="button" title={t.label} className="swatch" style={{ background: t.swatch }} onClick={() => applyTheme(t.id)} />
          ))}
        </div>
      </form>
    </div>
  );
}
