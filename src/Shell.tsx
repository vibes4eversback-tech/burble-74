import { useEffect, useRef, useState } from 'react';
import * as api from './lib/api';
import { subscribeChannel, type ChatEvent } from './lib/realtime';
import type { Channel, Message, Profile, Server } from './lib/types';
import type { Session } from './lib/supabase';
import { THEMES, type ThemeId } from './lib/theme';
import { RolesPanel } from './RolesPanel';
import { WebhooksPanel } from './WebhooksPanel';
import { PERM, can } from './lib/types';
import type { Attachment } from './lib/types';

const TENOR_KEY = import.meta.env.VITE_TENOR_API_KEY as string | undefined;
const URL_RE = /^https?:\/\/\S+$/i;
interface GifHit {
  id: string;
  url: string;
  preview: string;
}

interface Props {
  session: Session;
  theme: ThemeId;
  onTheme: (t: ThemeId) => void;
  onSignOut: () => void;
}

export function Shell({ session, theme, onTheme, onSignOut }: Props) {
  const [servers, setServers] = useState<Server[]>([]);
  const [serverId, setServerId] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [newServer, setNewServer] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [dms, setDms] = useState<Channel[]>([]);
  const [dmQuery, setDmQuery] = useState('');
  const [dmResults, setDmResults] = useState<Profile[]>([]);
  const [inDms, setInDms] = useState(false);
  const [dmPeers, setDmPeers] = useState<Record<string, string>>({});
  const [showRoles, setShowRoles] = useState(false);
  const [showWebhooks, setShowWebhooks] = useState(false);
  const [myPerms, setMyPerms] = useState(0);
  const [members, setMembers] = useState<Profile[]>([]);
  const [myProfile, setMyProfile] = useState<Profile | null>(null);
  const [profilePopout, setProfilePopout] = useState<Profile | null>(null);
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [showThemes, setShowThemes] = useState(false);
  const chanRef = useRef<ReturnType<typeof subscribeChannel> | null>(null);
  const lastTypingSent = useRef(0);

  const remember = (ids: string[]) => {
    const missing = ids.filter((id) => !profiles[id]);
    if (!missing.length) return;
    void api.getProfiles(missing).then((rows) =>
      setProfiles((p) => ({ ...p, ...Object.fromEntries(rows.map((r) => [r.id, r])) })),
    );
  };

  useEffect(() => {
    void api.listMyDms(session.userId).then(async (d) => {
      setDms(d);
      const peers = await api.listDmPeers(d.map((c) => c.id));
      remember(peers.map((p) => p.user_id).filter((u) => u !== session.userId));
      const map: Record<string, string> = {};
      for (const p of peers) {
        if (p.user_id !== session.userId) map[p.channel_id] = p.user_id;
      }
      setDmPeers(map);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.userId]);

  const openDmWith = async (userId: string) => {
    try {
      const id = await api.openDm(userId);
      const d = await api.listMyDms(session.userId);
      setDms(d);
      const peers = await api.listDmPeers([id]);
      const peer = peers.find((p) => p.user_id !== session.userId);
      if (peer) remember([peer.user_id]);
      setDmPeers((m) => ({ ...m, [id]: peer?.user_id ?? '' }));
      setInDms(true);
      setChannelId(id);
      setDmResults([]);
      setDmQuery('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open DM');
    }
  };

  const reload = () =>
    api.listMyServers(session.userId).then((s) => {
      setServers(s);
      setServerId((cur) => cur ?? s[0]?.id ?? null);
    });

  useEffect(() => {
    reload().catch((e: Error) => setError(e.message));
    api.getMyProfile(session.userId).then((profile) => {
      setMyProfile(profile);
      setProfiles((current) => ({ ...current, [profile.id]: profile }));
    }).catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.userId]);

  useEffect(() => {
    if (!serverId) return;
    api.listMembers(serverId)
      .then((rows) => api.getProfiles(rows.map((row) => row.user_id)))
      .then(setMembers)
      .catch((e: Error) => setError(e.message));
  }, [serverId]);

  useEffect(() => {
    if (!serverId) return;
    setChannelId(null);
    void computePerms(serverId);
    Promise.resolve(api.listChannels(serverId))
      .then((c) => {
        setChannels(c);
        setChannelId(c[0]?.id ?? null);
      })
      .catch((e: Error) => setError(e.message));
  }, [serverId]);

  useEffect(() => {
    if (!channelId) { setMessages([]); return; }
    let alive = true;
    Promise.resolve(api.listMessages(channelId))
      .then((m) => {
        if (!alive) return;
        setMessages(m);
        remember(m.map((x) => x.author_id).filter(Boolean) as string[]);
      })
      .catch((e: Error) => setError(e.message));

    const chan = subscribeChannel(channelId, (e: ChatEvent) => {
      if (e.type === 'message') {
        setMessages((ms) => (ms.some((m) => m.id === e.message.id) ? ms : [...ms, e.message]));
        remember(e.message.author_id ? [e.message.author_id] : []);
      } else if (e.type === 'edit') {
        setMessages((ms) => ms.map((m) => (m.id === e.message.id ? e.message : m)));
      } else if (e.type === 'delete') {
        setMessages((ms) => ms.filter((m) => m.id !== e.id));
      } else if (e.type === 'typing') {
        setTyping((t) => ({ ...t, [e.userId]: e.nickname }));
        setTimeout(() => setTyping((t) => {
          const n = { ...t };
          delete n[e.userId];
          return n;
        }), 3000);
      }
    });
    chanRef.current = chan;
    return () => {
      alive = false;
      chan.close();
      chanRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showGifs, setShowGifs] = useState(false);
  const [gifQuery, setGifQuery] = useState('');
  const [gifs, setGifs] = useState<GifHit[]>([]);

  const searchGifs = async () => {
    if (!TENOR_KEY || !gifQuery.trim()) return;
    try {
      const r = await fetch(
        `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(gifQuery)}&key=${TENOR_KEY}&limit=12&media_filter=gif,tinygif`,
      );
      if (!r.ok) throw new Error('GIF search failed');
      const j = (await r.json()) as { results: { id: string; media_formats: { gif?: { url: string }; tinygif?: { url: string } } }[] };
      setGifs(
        j.results.flatMap((g) =>
          g.media_formats.gif ? [{ id: g.id, url: g.media_formats.gif.url, preview: g.media_formats.tinygif?.url ?? g.media_formats.gif.url }] : [],
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'GIF search failed');
    }
  };

  const sendGif = async (g: GifHit) => {
    if (!channelId) return;
    try {
      const msg = await api.sendMessage(channelId, session.userId, '', [{ url: g.url, name: 'gif', type: 'image/gif', kind: 'gif' }]);
      setMessages((ms) => (ms.some((m) => m.id === msg.id) ? ms : [...ms, msg]));
      chanRef.current?.send({ type: 'message', message: msg });
      setShowGifs(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed');
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text && !pendingFile) return;
    if (!channelId) return;
    setDraft('');
    try {
      const attachments: Attachment[] = [];
      if (pendingFile) {
        const url = await api.uploadMedia(session.userId, pendingFile);
        const kind: Attachment['kind'] = pendingFile.type.startsWith('image/')
          ? 'image'
          : pendingFile.type.startsWith('video/')
            ? 'video'
            : pendingFile.type.startsWith('audio/')
              ? 'audio'
              : 'file';
        attachments.push({ url, name: pendingFile.name, type: pendingFile.type, kind });
        setPendingFile(null);
      }
      const link = URL_RE.test(text) ? text : null;
      if (link) attachments.push({ url: link, name: link, type: 'text/html', kind: 'link' });
      const msg = await api.sendMessage(channelId, session.userId, link ? '' : text, attachments);
      setMessages((ms) => (ms.some((m) => m.id === msg.id) ? ms : [...ms, msg]));
      chanRef.current?.send({ type: 'message', message: msg });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed');
      setDraft(text);
    }
  };

  const onDraft = (v: string) => {
    setDraft(v);
    const now = Date.now();
    if (now - lastTypingSent.current > 2000) {
      lastTypingSent.current = now;
      chanRef.current?.send({ type: 'typing', userId: session.userId, nickname: session.nickname });
    }
  };

  // Mirrors user_server_perms(): owner is admin, otherwise @everyone plus assigned roles.
  const computePerms = async (sid: string) => {
    const srv = servers.find((s) => s.id === sid);
    if (srv?.owner_id === session.userId) return setMyPerms(PERM.ADMIN);
    const [roles, mr] = await Promise.all([api.listRoles(sid), api.listMemberRoles(sid)]);
    const mine = new Set(mr.filter((m) => m.user_id === session.userId).map((m) => m.role_id));
    setMyPerms(roles.filter((r) => r.is_default || mine.has(r.id)).reduce((acc, r) => acc | r.permissions, 0));
  };

  const createServer = async () => {
    if (!newServer.trim()) return;
    try {
      const id = await api.createServer(newServer.trim(), null, null);
      setNewServer('');
      await reload();
      setServerId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create server');
    }
  };

  const join = async () => {
    if (!inviteCode.trim()) return;
    try {
      const id = await api.joinServer(inviteCode.trim());
      setInviteCode('');
      await reload();
      setServerId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join');
    }
  };

  const server = servers.find((s) => s.id === serverId);
  const channel = channels.find((c) => c.id === channelId) ?? dms.find((c) => c.id === channelId);
  const isDm = channel?.kind === 'dm';
  const dmLabel = (id: string) => {
    const uid = dmPeers[id];
    return (uid && profiles[uid]?.nickname) || 'Direct message';
  };
  const typers = Object.values(typing).filter((n) => n !== session.nickname);

  return (
    <div className="shell">
      <nav className="glass rail">
        <button title="Direct messages" className={`server-pill dm-pill ${inDms ? 'active' : ''}`} onClick={() => { setInDms(true); setServerId(null); }}>
          DM
        </button>
        <div className="rail-divider" />
        {servers.map((s) => (
          <button key={s.id} title={s.name} className={`server-pill ${s.id === serverId && !inDms ? 'active' : ''}`} onClick={() => { setInDms(false); setServerId(s.id); }}>
            {s.name.slice(0, 2).toUpperCase()}
          </button>
        ))}
      </nav>

      <aside className="glass side">
        <header className="side-header"><strong>{inDms ? 'Direct messages' : server?.name ?? 'Burble'}</strong></header>
        <div className="list">
          {inDms && (
            <button className="side-item dm-home active" onClick={() => { setChannelId(null); setDmQuery(''); }}>Find or start a conversation</button>
          )}
          {inDms && (
            <>
              <input className="input" placeholder="Find a nickname" value={dmQuery} onChange={(e) => {
                setDmQuery(e.target.value);
                if (e.target.value.trim().length >= 2) void api.searchProfiles(e.target.value.trim()).then((r) => setDmResults(r.filter((p) => p.id !== session.userId)));
                else setDmResults([]);
              }} />
              {dmResults.map((p) => (
                <button key={p.id} className="side-item" onClick={() => void openDmWith(p.id)}>@ {p.nickname}</button>
              ))}
              {dms.map((c) => (
                <button key={c.id} className={`side-item ${c.id === channelId ? 'active' : ''}`} onClick={() => setChannelId(c.id)}>
                  ✉ {dmLabel(c.id)}
                </button>
              ))}
            </>
          )}
          {!inDms && channels.map((c) => (
            <button key={c.id} className={`side-item ${c.id === channelId ? 'active' : ''}`} onClick={() => setChannelId(c.id)}>
              # {c.name}
            </button>
          ))}
        </div>
        {!inDms && serverId && <div className="side-actions">
          <button className="btn" onClick={() => setShowServerSettings(true)} disabled={!can(myPerms, PERM.MANAGE_SERVER)} title="Manage server">Server settings</button>
        </div>}
        <div className="side-spacer" />
        <div className="profile-card">
          <div className="avatar small-avatar">{myProfile?.avatar_url ? <img src={myProfile.avatar_url} alt="" /> : session.nickname.slice(0, 1).toUpperCase()}</div>
          <div className="profile-copy"><strong>{session.nickname}</strong><span className="muted">Online</span></div>
          <label className="icon-button" title="Change avatar">Avatar<input type="file" accept="image/*,.gif" hidden onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            void api.uploadMedia(session.userId, file).then((url) => api.updateProfile(session.userId, { avatar_url: url })).then(setMyProfile).catch((err: Error) => setError(err.message));
          }} /></label>
          <button className="icon-button" title="Change theme" onClick={() => setShowThemes(true)}>Theme</button>
          <button className="icon-button" title="Sign out" onClick={onSignOut}>Exit</button>
        </div>
      </aside>

      {showRoles && serverId && (
        <RolesPanel serverId={serverId} myPerms={myPerms} onClose={() => setShowRoles(false)} onError={setError} />
      )}

      {showWebhooks && serverId && (
        <WebhooksPanel serverId={serverId} userId={session.userId} myPerms={myPerms} channels={channels} onClose={() => setShowWebhooks(false)} onError={setError} />
      )}
      {showThemes && <div className="modal-bg" onClick={() => setShowThemes(false)}><section className="glass modal" onClick={(e) => e.stopPropagation()}><h2>Theme</h2><div className="theme-row">{THEMES.map((t) => <button key={t.id} className={`swatch ${theme === t.id ? 'active' : ''}`} style={{ background: t.swatch }} title={t.label} onClick={() => { onTheme(t.id); setShowThemes(false); }} />)}</div><button className="btn" onClick={() => setShowThemes(false)}>Close</button></section></div>}
      {showServerSettings && serverId && <div className="modal-bg" onClick={() => setShowServerSettings(false)}><section className="glass modal" onClick={(e) => e.stopPropagation()}><h2>{server?.name} settings</h2><button className="btn" onClick={() => { setShowRoles(true); setShowServerSettings(false); }}>Roles</button><button className="btn" onClick={() => { setShowWebhooks(true); setShowServerSettings(false); }}>Webhooks</button><button className="btn" onClick={() => setShowServerSettings(false)}>Close</button></section></div>}
      {profilePopout && <div className="modal-bg" onClick={() => setProfilePopout(null)}><section className="glass profile-popout" onClick={(e) => e.stopPropagation()}><div className="profile-banner" style={{ backgroundImage: profilePopout.banner_url ? `url(${profilePopout.banner_url})` : undefined }} /><div className="avatar profile-large">{profilePopout.avatar_url ? <img src={profilePopout.avatar_url} alt={`${profilePopout.nickname} avatar`} /> : profilePopout.nickname.slice(0, 1)}</div><h2>{profilePopout.nickname}</h2><p className="muted">{profilePopout.bio || 'No bio yet.'}</p><button className="btn primary" onClick={() => { setProfilePopout(null); void openDmWith(profilePopout.id); }}>Message</button></section></div>}

      <main className="glass main">
        <header className="topbar">
          <strong>{isDm ? `✉ ${dmLabel(channel!.id)}` : `# ${channel?.name ?? '—'}`}</strong>
          {error && <span className="error" onClick={() => setError(null)}>{error}</span>}
        </header>
        <section className="messages">
          {messages.map((m) => {
            const who = m.author_id ? profiles[m.author_id]?.nickname ?? 'Unknown' : m.author_name ?? 'Webhook';
            return (
              <div className="msg" key={m.id}>
                <button className="avatar avatar-button" onClick={() => m.author_id && profiles[m.author_id] && setProfilePopout(profiles[m.author_id])} aria-label={`View ${who}'s profile`}>{m.author_id && profiles[m.author_id]?.avatar_url ? <img src={profiles[m.author_id].avatar_url!} alt={`${who} avatar`} /> : who.slice(0, 1).toUpperCase()}</button>
                <div>
                  <div className="msg-head">
                    <strong>{who}</strong>
                    <span className="muted" style={{ fontSize: 12 }}>{new Date(m.created_at).toLocaleTimeString()}</span>
                  </div>
                  {m.content && <div className="msg-body">{m.content}</div>}
                  {m.attachments.map((a) =>
                    a.kind === 'image' || a.kind === 'gif' ? (
                      <img key={a.url} src={a.url} alt={a.name} style={{ maxWidth: 320, borderRadius: 12, display: 'block' }} />
                    ) : a.kind === 'video' ? (
                      <video key={a.url} src={a.url} controls style={{ maxWidth: 320, display: 'block' }} />
                    ) : a.kind === 'audio' ? (
                      <audio key={a.url} src={a.url} controls />
                    ) : a.kind === 'link' ? (
                      <a key={a.url} href={a.url} target="_blank" rel="noreferrer noopener">{a.name}</a>
                    ) : (
                      <a key={a.url} href={a.url} target="_blank" rel="noreferrer noopener">📎 {a.name}</a>
                    ),
                  )}
                </div>
              </div>
            );
          })}
        </section>
        <div>
          <div className="typing">{typers.length ? `${typers.join(', ')} typing…` : ''}</div>
          <div className="composer glass" style={{ margin: 12, borderRadius: 20 }}>
            <div className="composer-row">
              <input
                className="input"
                placeholder={channel ? `Message #${channel.name}` : 'Pick a channel'}
                value={draft}
                disabled={!channel}
                onChange={(e) => onDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), void send())}
              />
              <label className="btn">
                📎
                <input
                  type="file"
                  accept="image/*,.gif,video/*,audio/*,.pdf,.txt,.zip"
                  hidden
                  disabled={!channel}
                  onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
                />
              </label>
              {TENOR_KEY && (
                <button className="btn" disabled={!channel} onClick={() => setShowGifs((s) => !s)}>GIF</button>
              )}
              <button className="btn primary" onClick={() => void send()} disabled={!draft.trim() && !pendingFile}>Send</button>
            </div>
            {pendingFile && <small className="muted">Attaching {pendingFile.name}</small>}
            {showGifs && (
              <div className="composer-row">
                <input className="input" placeholder="Search GIFs" value={gifQuery} onChange={(e) => setGifQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void searchGifs()} />
                <button className="btn" onClick={() => void searchGifs()}>Search</button>
                {gifs.map((g) => (
                  <img key={g.id} src={g.preview} alt="GIF" width={96} style={{ borderRadius: 8, cursor: 'pointer' }} onClick={() => void sendGif(g)} />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
      {!inDms && serverId && (
        <aside className="glass members-panel">
          <div className="members-title">Members — {members.length}</div>
          <div className="members-list">
            {members.map((member) => (
              <button className="member-row" key={member.id} onClick={() => setProfilePopout(member)} title={`View ${member.nickname}'s profile`}>
                <div className="avatar member-avatar">{member.avatar_url ? <img src={member.avatar_url} alt="" /> : member.nickname.slice(0, 1).toUpperCase()}</div>
                <span>{member.nickname}{member.id === server?.owner_id ? ' · owner' : ''}</span>
              </button>
            ))}
          </div>
          {server?.invite_code && <button className="invite-button" onClick={() => navigator.clipboard?.writeText(server.invite_code)}>Copy invite code</button>}
        </aside>
      )}
    </div>
  );
}
